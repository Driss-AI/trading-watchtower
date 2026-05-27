// ─── TOPSTEPX SIGNALR WEBSOCKET MANAGER ──────────────────────────────────────
// Manages persistent SignalR connections to TopstepX real-time hubs.
// Two hubs:
//   User Hub   (rtc.topstepx.com/hubs/user)   — trades, account, positions, orders
//   Market Hub (rtc.topstepx.com/hubs/market) — live quotes, ticks, depth
//
// ⚠️  READ-ONLY listener. Order execution remains permanently disabled.

import * as signalR from '@microsoft/signalr'
import { z } from 'zod'
import { getTopstepXToken } from './topstepx'

// ─── ZOD SCHEMA FOR GATEWAY QUOTE ─────────────────────────────────────────────
const RawQuoteSchema = z.object({
  lastPrice:      z.number().optional(),
  bestBid:        z.number().optional(),
  bestAsk:        z.number().optional(),
  change:         z.number().optional(),
  changePercent:  z.number().optional(),
  open:           z.number().optional(),
  high:           z.number().optional(),
  low:            z.number().optional(),
  volume:         z.number().optional(),
  timestamp:      z.union([z.string(), z.number()]).optional(),
  lastUpdated:    z.union([z.string(), z.number()]).optional(),
}).passthrough()

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

// _desiredContracts — what SSE clients have asked to subscribe to. Persists
// across hub reconnects so every new hub instance can re-subscribe.
// _subscribedContracts — what is actually subscribed on the CURRENT hub instance.
const _desiredContracts    = new Set<string>()
const _subscribedContracts = new Set<string>()

// Last-known quote per contract (so a new SSE client gets an immediate value)
const _lastQuote = new Map<string, WSQuote>()

// Promise-based locks — prevent concurrent connect() calls from racing
let _userConnecting:   Promise<void> | null = null
let _marketConnecting: Promise<void> | null = null

// Guard against overlapping reconnect attempts
let _userReconnecting = false
let _marketReconnecting = false

// ─── BROADCAST ────────────────────────────────────────────────────────────────

function broadcast(event: WSEvent) {
  _handlers.forEach((h) => {
    try { h(event) } catch {}
  })
}

// Translate a raw ProjectX GatewayQuote payload to our WSQuote shape.
// ProjectX sends delta updates — after the first full snapshot, subsequent ticks
// only include fields that changed. lastPrice is omitted when unchanged, causing
// price=0. Fall back to the last known price, then bestBid as a proxy.
function toWSQuote(contractId: string, raw: any): WSQuote {
  const prev = _lastQuote.get(contractId)
  const bid  = raw?.bestBid  != null ? Number(raw.bestBid)  : (prev?.bid  ?? 0)
  const ask  = raw?.bestAsk  != null ? Number(raw.bestAsk)  : (prev?.ask  ?? 0)
  const rawPrice = raw?.lastPrice != null ? Number(raw.lastPrice) : 0
  // Use raw lastPrice if present, else last known price, else bestBid as proxy
  const price = rawPrice > 0 ? rawPrice : (prev?.price ?? 0) > 0 ? prev!.price : bid
  return {
    contractId,
    ask,
    bid,
    price,
    open:         Number(raw?.open         ?? prev?.open         ?? 0),
    change:       Number(raw?.change       ?? prev?.change       ?? 0),
    changePct:    Number(raw?.changePercent ?? prev?.changePct   ?? 0),
    volume:       Number(raw?.volume       ?? prev?.volume       ?? 0),
    sessionHigh:  Number(raw?.high         ?? prev?.sessionHigh  ?? 0),
    sessionLow:   Number(raw?.low          ?? prev?.sessionLow  ?? 0),
    timestamp:    String(raw?.timestamp ?? raw?.lastUpdated ?? new Date().toISOString()),
  }
}

// ─── GATEWAY LOGOUT HANDLER ───────────────────────────────────────────────────
// TopStepX sends 'gatewaylogout' when the session is invalidated (token expired,
// maintenance, etc). We must refresh the token and reconnect.

async function handleGatewayLogout(hubName: string) {
  console.log(`[TopstepX WS] gatewaylogout received on ${hubName} hub — reconnecting with fresh token`)
  broadcast({ type: 'disconnected', hub: hubName, reason: 'gatewaylogout' })

  // Small delay to let the server-side cleanup finish
  await new Promise((r) => setTimeout(r, 2000))

  try {
    if (hubName === 'user') {
      await reconnectUserHub()
    } else {
      await reconnectMarketHub()
    }
  } catch (err) {
    console.error(`[TopstepX WS] Failed to reconnect ${hubName} hub after gatewaylogout:`, err)
  }
}

async function reconnectUserHub() {
  if (_userReconnecting) return
  _userReconnecting = true
  try {
    if (_userHub) {
      try { await _userHub.stop() } catch {}
      _userHub = null
    }
    _userHub = await buildUserHub()
    await _userHub.start()
    broadcast({ type: 'connected', hub: 'user' })
    console.log('[TopstepX WS] User hub reconnected after gatewaylogout')
  } finally {
    _userReconnecting = false
  }
}

async function reconnectMarketHub() {
  if (_marketReconnecting) return
  _marketReconnecting = true
  try {
    if (_marketHub) {
      try { await _marketHub.stop() } catch {}
      _marketHub = null
    }
    _subscribedContracts.clear()

    _marketHub = await buildMarketHub()
    await _marketHub.start()

    // Re-subscribe to everything SSE clients have requested (_desiredContracts).
    for (const contractId of Array.from(_desiredContracts)) {
      try {
        await _marketHub.invoke('SubscribeContractQuotes', contractId)
        _subscribedContracts.add(contractId)
        console.log(`[TopstepX WS] Re-subscribed to quotes (sim): ${contractId}`)
      } catch (err) {
        console.error(`[TopstepX WS] Failed to re-subscribe to ${contractId}:`, err)
      }
    }
    broadcast({ type: 'connected', hub: 'market' })
    console.log('[TopstepX WS] Market hub reconnected after gatewaylogout')
  } finally {
    _marketReconnecting = false
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

  // SignalR normalises event names to lowercase — registering both 'gatewaylogout'
  // and 'GatewayLogout' fires the handler TWICE per event. Keep only one.
  hub.on('GatewayLogout', () => handleGatewayLogout('user'))

  hub.onreconnected(() => broadcast({ type: 'connected', hub: 'user' }))
  hub.onreconnecting(() => broadcast({ type: 'disconnected', hub: 'user', reason: 'reconnecting' }))
  hub.onclose((err) => broadcast({ type: 'disconnected', hub: 'user', reason: err?.message }))

  return hub
}

export async function connectUserHub(): Promise<void> {
  if (_userHub?.state === signalR.HubConnectionState.Connected) return
  if (_userConnecting) return _userConnecting

  _userConnecting = (async () => {
    if (_userHub) { try { await _userHub.stop() } catch {} }
    _userHub = await buildUserHub()
    await _userHub.start()
    broadcast({ type: 'connected', hub: 'user' })
    console.log('[TopstepX WS] User hub connected')
  })().finally(() => { _userConnecting = null })

  return _userConnecting
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
  let _quoteLogCount = 0
  hub.on('GatewayQuote', (contractId: string, raw: unknown) => {
    const parsed = RawQuoteSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn('[TopstepX WS] Unexpected GatewayQuote shape:', raw)
      return
    }
    const data = toWSQuote(contractId, parsed.data)
    _lastQuote.set(contractId, data)
    broadcast({ type: 'quote', data })
    // Log the first 3 quotes per hub instance to confirm flow without spamming
    if (_quoteLogCount < 3) {
      _quoteLogCount++
      console.log(`[TopstepX WS] GatewayQuote #${_quoteLogCount}: ${contractId} price=${data.price} bid=${data.bid} ask=${data.ask}`)
    }
  })

  hub.on('GatewayTrade', (_contractId: string, _raw: any) => {
    // Not currently surfaced to consumers — would need a separate event type.
    // Left as a no-op so we don't drop the subscription if invoked.
  })

  hub.on('GatewayDepth', (_contractId: string, _raw: any) => {
    // Same — DOM events not currently surfaced.
  })

  hub.on('GatewayLogout', () => handleGatewayLogout('market'))

  hub.onreconnected(async () => {
    // Re-subscribe to all desired contracts after SignalR auto-reconnect.
    _subscribedContracts.clear()
    for (const contractId of Array.from(_desiredContracts)) {
      try {
        await hub.invoke('SubscribeContractQuotes', contractId)
        _subscribedContracts.add(contractId)
        console.log(`[TopstepX WS] Re-subscribed after auto-reconnect: ${contractId}`)
      } catch {}
    }
    broadcast({ type: 'connected', hub: 'market' })
  })
  hub.onclose((err) => broadcast({ type: 'disconnected', hub: 'market', reason: err?.message }))

  return hub
}

export async function connectMarketHub(): Promise<void> {
  const state = _marketHub?.state
  if (state === signalR.HubConnectionState.Connected) return
  // If SignalR is already attempting its own auto-reconnect, don't interfere —
  // stopping the hub here would cancel that reconnect and restart the 30s cycle.
  if (state === signalR.HubConnectionState.Reconnecting) return
  if (state === signalR.HubConnectionState.Connecting) return
  if (_marketConnecting) return _marketConnecting

  _marketConnecting = (async () => {
    // Re-check inside the lock
    const s = _marketHub?.state
    if (s === signalR.HubConnectionState.Connected) return
    if (s === signalR.HubConnectionState.Reconnecting) return
    if (_marketHub) { try { await _marketHub.stop() } catch {} }
    // Clear stale subscription tracking so subscribeToQuote() will re-invoke
    // SubscribeContractQuotes on the new hub instead of returning early.
    _subscribedContracts.clear()
    _marketHub = await buildMarketHub()
    await _marketHub.start()
    broadcast({ type: 'connected', hub: 'market' })
    console.log('[TopstepX WS] Market hub connected')
  })().finally(() => { _marketConnecting = null })

  return _marketConnecting
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
  // Register intent — persists across hub restarts so every new hub can re-subscribe.
  _desiredContracts.add(contractId)

  if (!_marketHub || _marketHub.state !== signalR.HubConnectionState.Connected) {
    console.log(`[TopstepX WS] subscribeToQuote deferred — hub state: ${_marketHub ? signalR.HubConnectionState[_marketHub.state] : 'null'}, will subscribe on reconnect`)
    return
  }
  if (_subscribedContracts.has(contractId)) {
    console.log(`[TopstepX WS] Already subscribed (idempotent): ${contractId}`)
    return
  }
  console.log(`[TopstepX WS] Invoking SubscribeContractQuotes for ${contractId}`)
  try {
    await _marketHub.invoke('SubscribeContractQuotes', contractId)
    _subscribedContracts.add(contractId)
    console.log(`[TopstepX WS] Subscribed to quotes (sim): ${contractId}`)
  } catch (err) {
    console.error(`[TopstepX WS] SubscribeContractQuotes FAILED for ${contractId}:`, err)
  }
}

export async function unsubscribeFromQuote(contractId: string): Promise<void> {
  _desiredContracts.delete(contractId)
  _subscribedContracts.delete(contractId)
  _lastQuote.delete(contractId)
  if (_marketHub?.state === signalR.HubConnectionState.Connected) {
    try { await _marketHub.invoke('UnsubscribeContractQuotes', contractId) } catch {}
  }
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
