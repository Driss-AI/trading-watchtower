// ─── TOPSTEPX SIGNALR WEBSOCKET MANAGER ──────────────────────────────────────
// Manages persistent SignalR connections to TopstepX real-time hubs.
// Two hubs:
//   User Hub   (rtc.topstepx.com/hubs/user)   — trades, account, positions, orders
//   Market Hub (rtc.topstepx.com/hubs/market) — live quotes, ticks, depth
//
// ⚠️  READ-ONLY listener. Order execution remains permanently disabled.

import * as signalR from '@microsoft/signalr'
import { z } from 'zod'
import { getTopstepXToken, invalidateTokenCache } from './topstepx'

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

// ─── ORDER-FLOW PROBE STATE ────────────────────────────────────────────────────
// Trade-tape (GatewayTrade) and DOM (GatewayDepth) subscriptions + a small ring
// buffer of recent raw payloads. Lets us confirm these streams flow on the
// combine/sim feed before building delta / liquidity-heatmap aggregation on them.
const _desiredTrades    = new Set<string>()
const _desiredDepth     = new Set<string>()
const _subscribedTrades = new Set<string>()
const _subscribedDepth  = new Set<string>()

interface OFSample { contractId: string; raw: unknown; at: string }
const _tradeSamples: OFSample[] = []
const _depthSamples: OFSample[] = []
const OF_SAMPLE_CAP = 40
let _tradeCount = 0
let _depthCount = 0

function pushSample(buf: OFSample[], contractId: string, raw: unknown): void {
  buf.push({ contractId, raw, at: new Date().toISOString() })
  if (buf.length > OF_SAMPLE_CAP) buf.shift()
}

export function getOrderflowSamples() {
  return {
    tradeCount: _tradeCount,
    depthCount: _depthCount,
    subscribedTrades: Array.from(_subscribedTrades),
    subscribedDepth: Array.from(_subscribedDepth),
    tradeSamples: [..._tradeSamples],
    depthSamples: [..._depthSamples],
  }
}

export function resetOrderflowSamples(): void {
  _tradeSamples.length = 0
  _depthSamples.length = 0
  _tradeCount = 0
  _depthCount = 0
}

// Promise-based locks — prevent concurrent connect() calls from racing
let _userConnecting:   Promise<void> | null = null
let _marketConnecting: Promise<void> | null = null


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
// TopStepX sends 'gatewaylogout' when the session is invalidated (another login,
// token expired, maintenance). Both hubs fire simultaneously, so we coordinate
// into a single reconnect cycle that:
//   1. Invalidates the stale token cache
//   2. Stops both hubs
//   3. Fetches a fresh token via loginKey
//   4. Reconnects both hubs with the fresh token
//   5. Re-subscribes to all desired contracts
// Backoff prevents infinite loops when another TopStepX client is fighting us.

let _logoutTimestamps: number[] = []
let _fullReconnectLock = false

async function handleGatewayLogout(hubName: string) {
  // Both hubs fire gatewaylogout simultaneously — only run the reconnect once
  if (_fullReconnectLock) {
    console.log(`[TopstepX WS] gatewaylogout on ${hubName} — reconnect already in progress, skipping`)
    return
  }

  const now = Date.now()
  _logoutTimestamps = _logoutTimestamps.filter((t) => now - t < 120_000)
  _logoutTimestamps.push(now)

  if (_logoutTimestamps.length > 5) {
    console.error(`[TopstepX WS] ${_logoutTimestamps.length} gatewaylogouts in 2 min — backing off. Is TopStepX open in another app/browser?`)
    broadcast({ type: 'error', hub: hubName, message: 'Session conflict detected — close other TopStepX sessions and reload' })
    return
  }

  _fullReconnectLock = true
  const attempt = _logoutTimestamps.length
  console.log(`[TopstepX WS] gatewaylogout on ${hubName} — coordinated reconnect (attempt ${attempt})`)
  broadcast({ type: 'disconnected', hub: 'market', reason: 'gatewaylogout' })
  broadcast({ type: 'disconnected', hub: 'user', reason: 'gatewaylogout' })

  // Clear the stale token BEFORE reconnecting — this was the root cause of
  // "Invocation canceled due to the underlying connection being closed"
  invalidateTokenCache()

  const delay = Math.min(2000 * attempt, 15_000)
  await new Promise((r) => setTimeout(r, delay))

  try {
    // Stop both hubs cleanly
    if (_marketHub) { try { await _marketHub.stop() } catch {} }
    _marketHub = null
    _subscribedContracts.clear()

    if (_userHub) { try { await _userHub.stop() } catch {} }
    _userHub = null

    // Pre-fetch a fresh token so both hubs share the same session
    const token = await getTopstepXToken()
    console.log(`[TopstepX WS] Fresh token acquired (${token.slice(0, 12)}…), reconnecting hubs`)

    // Reconnect market hub first (price streaming is the priority)
    _marketHub = await buildMarketHub()
    await _marketHub.start()

    for (const contractId of Array.from(_desiredContracts)) {
      try {
        await _marketHub.invoke('SubscribeContractQuotes', contractId)
        _subscribedContracts.add(contractId)
        console.log(`[TopstepX WS] Re-subscribed after gatewaylogout: ${contractId}`)
      } catch (err) {
        console.error(`[TopstepX WS] Failed to re-subscribe to ${contractId}:`, err)
      }
    }
    await resubscribeTradesDepth(_marketHub)
    broadcast({ type: 'connected', hub: 'market' })

    // Reconnect user hub (same token, same session)
    _userHub = await buildUserHub()
    await _userHub.start()
    broadcast({ type: 'connected', hub: 'user' })

    console.log('[TopstepX WS] Both hubs reconnected after gatewaylogout')
  } catch (err) {
    console.error('[TopstepX WS] Failed to reconnect after gatewaylogout:', err)
  } finally {
    _fullReconnectLock = false
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
  let _lastBroadcastTime = 0
  const BROADCAST_THROTTLE_MS = 100

  hub.on('GatewayQuote', (contractId: string, raw: unknown) => {
    // Validate first 3 quotes, then trust the shape for performance
    if (_quoteLogCount < 3) {
      const parsed = RawQuoteSchema.safeParse(raw)
      if (!parsed.success) {
        console.warn('[TopstepX WS] Unexpected GatewayQuote shape:', raw)
        return
      }
    }
    const data = toWSQuote(contractId, raw)
    _lastQuote.set(contractId, data)

    // Throttle broadcast to ~10/sec — subscribers (SSE, paper engine) don't need every tick
    const now = Date.now()
    if (now - _lastBroadcastTime >= BROADCAST_THROTTLE_MS) {
      _lastBroadcastTime = now
      broadcast({ type: 'quote', data })
    }

    if (_quoteLogCount < 3) {
      _quoteLogCount++
      console.log(`[TopstepX WS] GatewayQuote #${_quoteLogCount}: ${contractId} price=${data.price} bid=${data.bid} ask=${data.ask}`)
    }
  })

  let _tradeLogCount = 0
  hub.on('GatewayTrade', (contractId: string, raw: unknown) => {
    _tradeCount++
    pushSample(_tradeSamples, contractId, raw)
    if (_tradeLogCount < 3) {
      _tradeLogCount++
      console.log(`[TopstepX WS] GatewayTrade #${_tradeLogCount}: ${contractId}`, JSON.stringify(raw))
    }
  })

  let _depthLogCount = 0
  hub.on('GatewayDepth', (contractId: string, raw: unknown) => {
    _depthCount++
    pushSample(_depthSamples, contractId, raw)
    if (_depthLogCount < 3) {
      _depthLogCount++
      console.log(`[TopstepX WS] GatewayDepth #${_depthLogCount}: ${contractId}`, JSON.stringify(raw))
    }
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
    await resubscribeTradesDepth(hub)
    broadcast({ type: 'connected', hub: 'market' })
  })
  hub.onclose((err) => broadcast({ type: 'disconnected', hub: 'market', reason: err?.message }))

  return hub
}

export async function connectMarketHub(): Promise<void> {
  if (_fullReconnectLock) return
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
    _subscribedTrades.clear()
    _subscribedDepth.clear()
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

// Subscribe to the trade tape (GatewayTrade) and DOM (GatewayDepth) for a
// contract. Intent persists in the desired-sets so reconnects re-subscribe.
export async function subscribeToTradesAndDepth(contractId: string): Promise<void> {
  _desiredTrades.add(contractId)
  _desiredDepth.add(contractId)

  if (!_marketHub || _marketHub.state !== signalR.HubConnectionState.Connected) {
    console.log('[TopstepX WS] subscribeToTradesAndDepth deferred — hub not connected, will subscribe on reconnect')
    return
  }
  if (!_subscribedTrades.has(contractId)) {
    try {
      await _marketHub.invoke('SubscribeContractTrades', contractId)
      _subscribedTrades.add(contractId)
      console.log(`[TopstepX WS] Subscribed to trades: ${contractId}`)
    } catch (err) {
      console.error(`[TopstepX WS] SubscribeContractTrades FAILED for ${contractId}:`, err)
    }
  }
  if (!_subscribedDepth.has(contractId)) {
    try {
      await _marketHub.invoke('SubscribeContractMarketDepth', contractId)
      _subscribedDepth.add(contractId)
      console.log(`[TopstepX WS] Subscribed to depth: ${contractId}`)
    } catch (err) {
      console.error(`[TopstepX WS] SubscribeContractMarketDepth FAILED for ${contractId}:`, err)
    }
  }
}

// Re-invoke trade/depth subscriptions on a (re)connected hub instance.
async function resubscribeTradesDepth(hub: signalR.HubConnection): Promise<void> {
  _subscribedTrades.clear()
  _subscribedDepth.clear()
  for (const contractId of Array.from(_desiredTrades)) {
    try { await hub.invoke('SubscribeContractTrades', contractId); _subscribedTrades.add(contractId) } catch {}
  }
  for (const contractId of Array.from(_desiredDepth)) {
    try { await hub.invoke('SubscribeContractMarketDepth', contractId); _subscribedDepth.add(contractId) } catch {}
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
