// ─── TOPSTEPX SIGNALR WEBSOCKET MANAGER ──────────────────────────────────────
// Manages persistent SignalR connections to TopstepX real-time hubs.
// Two hubs:
//   User Hub   (rtc.topstepx.com/hubs/user)   — trades, account, positions, orders
//   Market Hub (rtc.topstepx.com/hubs/market) — live quotes, ticks, depth
//
// ⚠️  READ-ONLY listener. Order execution remains permanently disabled.

import * as signalR from '@microsoft/signalr'
import { getTopstepXToken } from './topstepx'

const WS_BASE = process.env.TOPSTEPX_WS_URL ?? 'https://rtc.topstepx.com'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface WSUserTrade {
  accountId: number
  contractId: string
  id: number
  price: number
  profitAndLoss: number
  fees: number
  side: number        // 0=BUY, 1=SELL
  size: number
  timestamp: string
  orderId?: number
}

export interface WSUserAccount {
  accountId: number
  balance: number
  canTrade: boolean
  timestamp: string
}

export interface WSUserPosition {
  accountId: number
  contractId: string
  type: number         // 1=LONG, 2=SHORT, 0=FLAT
  size: number
  averagePrice: number
  timestamp: string
}

export interface WSUserOrder {
  accountId: number
  contractId: string
  id: number
  status: string
  side: number
  size: number
  price?: number
  timestamp: string
}

// Internal shape that consumers use. We translate the raw ProjectX
// GatewayQuote payload into this shape inside the handler so the rest of
// the app doesn't have to know about ProjectX's field names.
export interface WSQuote {
  contractId: string
  ask: number
  bid: number
  price: number          // last traded price
  open: number
  change: number
  changePct: number
  volume: number
  sessionHigh: number
  sessionLow: number
  timestamp: string
}

export type WSEvent =
  | { type: 'trade';    data: WSUserTrade }
  | { type: 'account';  data: WSUserAccount }
  | { type: 'position'; data: WSUserPosition }
  | { type: 'order';    data: WSUserOrder }
  | { type: 'quote';    data: WSQuote }
  | { type: 'connected'; hub: string }
  | { type: 'disconnected'; hub: string; reason?: string }
  | { type: 'error'; hub: string; message: string }

export type WSEventHandler = (event: WSEvent) => void

// ─── CONNECTION STATE ─────────────────────────────────────────────────────────
// Module-level singletons — survive across requests in the same Node.js process

let _userHub:   signalR.HubConnection | null = null
let _marketHub: signalR.HubConnection | null = null
const _handlers = new Set<WSEventHandler>()
const _subscribedContracts = new Set<string>()
// Last-known quote per contract (so a new SSE client gets an immediate value)
const _lastQuote = new Map<string, WSQuote>()

// ─── BROADCAST ────────────────────────────────────────────────────────────────

function broadcast(event: WSEvent) {
  _handlers.forEach((h) => {
    try { h(event) } catch {}
  })
}

// Translate a raw ProjectX GatewayQuote payload to our WSQuote shape.
// ProjectX sends: { symbol, symbolName, lastPrice, bestBid, bestAsk, change,
//                   changePercent, open, high, low, volume, lastUpdated, timestamp }
function toWSQuote(contractId: string, raw: any): WSQuote {
  return {
    contractId,
    ask:          Number(raw?.bestAsk      ?? 0),
    bid:          Number(raw?.bestBid      ?? 0),
    price:        Number(raw?.lastPrice    ?? 0),
    open:         Number(raw?.open         ?? 0),
    change:       Number(raw?.change       ?? 0),
    changePct:    Number(raw?.changePercent ?? 0),
    volume:       Number(raw?.volume       ?? 0),
    sessionHigh:  Number(raw?.high         ?? 0),
    sessionLow:   Number(raw?.low          ?? 0),
    timestamp:    String(raw?.timestamp ?? raw?.lastUpdated ?? new Date().toISOString()),
  }
}

// ─── USER HUB ─────────────────────────────────────────────────────────────────

async function buildUserHub(): Promise<signalR.HubConnection> {
  const hub = new signalR.HubConnectionBuilder()
    .withUrl(`${WS_BASE}/hubs/user`, {
      accessTokenFactory: () => getTopstepXToken(),
      transport: signalR.HttpTransportType.WebSockets,
      skipNegotiation: true,
    })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
    .configureLogging(signalR.LogLevel.Warning)
    .build()

  hub.on('GatewayUserTrade', (data: WSUserTrade) => {
    broadcast({ type: 'trade', data })
  })

  hub.on('GatewayUserAccount', (data: WSUserAccount) => {
    broadcast({ type: 'account', data })
  })

  hub.on('GatewayUserPosition', (data: WSUserPosition) => {
    broadcast({ type: 'position', data })
  })

  hub.on('GatewayUserOrder', (data: WSUserOrder) => {
    broadcast({ type: 'order', data })
  })

  hub.onreconnected(() => broadcast({ type: 'connected', hub: 'user' }))
  hub.onreconnecting(() => broadcast({ type: 'disconnected', hub: 'user', reason: 'reconnecting' }))
  hub.onclose((err) => broadcast({ type: 'disconnected', hub: 'user', reason: err?.message }))

  return hub
}

export async function connectUserHub(): Promise<void> {   if (_userHub?.state === signalR.HubConnectionState.Connected) return   if (_connectingUser) return   _connectingUser = true   try {
  if (_userHub?.state === signalR.HubConnectionState.Connected) return

  if (_userHub) {
    try { await _userHub.stop() } catch {}
  }

  _userHub = await buildUserHub()
  await _userHub.start()
  broadcast({ type: 'connected', hub: 'user' })
  console.log('[TopstepX WS] User hub connected')
}

export async function disconnectUserHub(): Promise<void> {
  if (_userHub) {
    await _userHub.stop()
    _userHub = null
  }
}

export function getUserHubState(): string {
  if (!_userHub) return 'Disconnected'
  return signalR.HubConnectionState[_userHub.state] ?? 'Unknown'
}

// ─── MARKET HUB ───────────────────────────────────────────────────────────────

async function buildMarketHub(): Promise<signalR.HubConnection> {
  const hub = new signalR.HubConnectionBuilder()
    .withUrl(`${WS_BASE}/hubs/market`, {
      accessTokenFactory: () => getTopstepXToken(),
      transport: signalR.HttpTransportType.WebSockets,
      skipNegotiation: true,
    })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
    .configureLogging(signalR.LogLevel.Warning)
    .build()

  // ⚠️  Market Hub events take TWO args: (contractId, payload).
  // User Hub events take ONE arg. Don't confuse them.
  hub.on('GatewayQuote', (contractId: string, raw: any) => {
    const data = toWSQuote(contractId, raw)
    _lastQuote.set(contractId, data)
    broadcast({ type: 'quote', data })
  })

  hub.on('GatewayTrade', (_contractId: string, _raw: any) => {
    // Not currently surfaced to consumers — would need a separate event type.
    // Left as a no-op so we don't drop the subscription if invoked.
  })

  hub.on('GatewayDepth', (_contractId: string, _raw: any) => {
    // Same — DOM events not currently surfaced.
  })

  hub.onreconnected(async () => {
    broadcast({ type: 'connected', hub: 'market' })
    // Re-subscribe to all contracts after reconnect
    for (const contractId of Array.from(_subscribedContracts)) {
      try { await hub.invoke('SubscribeContractQuotes', contractId) } catch {}
    }
  })
  hub.onclose((err) => broadcast({ type: 'disconnected', hub: 'market', reason: err?.message }))

  return hub
}

export async function connectMarketHub(): Promise<void> {
  if (_marketHub?.state === signalR.HubConnectionState.Connected) return

  if (_marketHub) {
    try { await _marketHub.stop() } catch {}
  }

  _marketHub = await buildMarketHub()
  await _marketHub.start()
  broadcast({ type: 'connected', hub: 'market' })
  console.log('[TopstepX WS] Market hub connected')
}

export async function disconnectMarketHub(): Promise<void> {
  if (_marketHub) {
    await _marketHub.stop()
    _marketHub = null
  }
}

export function getMarketHubState(): string {
  if (!_marketHub) return 'Disconnected'
  return signalR.HubConnectionState[_marketHub.state] ?? 'Unknown'
}

// ─── CONTRACT SUBSCRIPTIONS ───────────────────────────────────────────────────

export async function subscribeToQuote(contractId: string): Promise<void> {
  if (!_marketHub || _marketHub.state !== signalR.HubConnectionState.Connected) {
    throw new Error('Market hub not connected — call connectMarketHub() first')
  }
  // Idempotent — if already subscribed, don't re-invoke.
  if (_subscribedContracts.has(contractId)) return
  await _marketHub.invoke('SubscribeContractQuotes', contractId)
  _subscribedContracts.add(contractId)
  console.log(`[TopstepX WS] Subscribed to quotes: ${contractId}`)
}

export async function unsubscribeFromQuote(contractId: string): Promise<void> {
  if (_marketHub?.state === signalR.HubConnectionState.Connected) {
    await _marketHub.invoke('UnsubscribeContractQuotes', contractId)
  }
  _subscribedContracts.delete(contractId)
  _lastQuote.delete(contractId)
}

export function getLastQuote(contractId: string): WSQuote | null {
  return _lastQuote.get(contractId) ?? null
}

// ─── EVENT SUBSCRIPTIONS ──────────────────────────────────────────────────────

export function subscribe(handler: WSEventHandler): () => void {
  _handlers.add(handler)
  return () => _handlers.delete(handler)
}

export function getConnectionStatus() {
  return {
    userHub: getUserHubState(),
    marketHub: getMarketHubState(),
    subscribedContracts: Array.from(_subscribedContracts),
    handlerCount: _handlers.size,
  }
}

// ─── SIGNALR CONNECTION TEST ──────────────────────────────────────────────────
// Lightweight test: attempts a full connect + immediate disconnect
// Used by the /api/topstepx/verify endpoint

export async function testSignalRConnection(): Promise<{ connected: boolean; error?: string }> {
  let hub: signalR.HubConnection | null = null
  try {
    hub = new signalR.HubConnectionBuilder()
      .withUrl(`${WS_BASE}/hubs/user`, {
        accessTokenFactory: () => getTopstepXToken(),
        transport: signalR.HttpTransportType.WebSockets,
        skipNegotiation: true,
      })
      .configureLogging(signalR.LogLevel.None)
      .build()

    await Promise.race([
      hub.start(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout (8s)')), 8000)),
    ])

    return { connected: true }
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (hub) {
      try { await hub.stop() } catch {}
    }
  }
}
