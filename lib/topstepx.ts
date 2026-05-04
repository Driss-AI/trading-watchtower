// ─── TOPSTEPX / PROJECTX API — FULLY IMPLEMENTED ────────────────────────────
// READ-ONLY: account status, P&L, positions, market data bars
// ORDER EXECUTION IS PERMANENTLY DISABLED — NEVER REMOVE THIS
//
// API Base:    https://api.topstepx.com
// Auth:        POST /api/Auth/loginKey → JWT (24h valid)
// Docs:        https://gateway.docs.projectx.com

const BASE_URL = process.env.TOPSTEPX_BASE_URL ?? 'https://api.topstepx.com'

// ─── TOKEN CACHE ─────────────────────────────────────────────────────────────
let _tokenCache: { token: string; expiresAt: number } | null = null

export async function getTopstepXToken(): Promise<string> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 30 * 60 * 1000) {
    return _tokenCache.token
  }

  const userName = process.env.TOPSTEPX_USERNAME ?? ''
  const apiKey   = process.env.TOPSTEPX_API_KEY   ?? ''

  if (!userName || !apiKey) {
    throw new Error('TopstepX not configured. Set TOPSTEPX_USERNAME and TOPSTEPX_API_KEY in Railway Variables.')
  }

  const res = await fetch(`${BASE_URL}/api/Auth/loginKey`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ userName, apiKey }),
    cache: 'no-store',
  })

  if (!res.ok) throw new Error(`TopstepX auth HTTP ${res.status}: ${await res.text()}`)

  const data = await res.json()
  if (!data.success) throw new Error(`TopstepX auth failed (${data.errorCode}): ${data.errorMessage}`)

  _tokenCache = { token: data.token, expiresAt: Date.now() + 23.5 * 60 * 60 * 1000 }
  console.log('[TopstepX] Token refreshed')
  return data.token
}

// ─── AUTHENTICATED POST ───────────────────────────────────────────────────────
async function apiPost<T = any>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const token = await getTopstepXToken()
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (res.status === 401) { _tokenCache = null; return apiPost(endpoint, body) }
  if (!res.ok) throw new Error(`TopstepX ${endpoint} HTTP ${res.status}`)
  const data = await res.json()
  if (data.success === false) throw new Error(`TopstepX ${endpoint} error (${data.errorCode}): ${data.errorMessage}`)
  return data as T
}

// ─── ACCOUNT ──────────────────────────────────────────────────────────────────
export interface TSXAccount {
  id: number
  name: string
  balance: number
  canTrade: boolean
  isVisible: boolean
}

export async function getAccounts(): Promise<TSXAccount[]> {
  const data = await apiPost<{ accounts: TSXAccount[] }>('/api/Account/search', { onlyActiveAccounts: true })
  return data.accounts ?? []
}

export async function getPrimaryAccount(): Promise<TSXAccount | null> {
  const accounts = await getAccounts()
  if (!accounts.length) return null
  const configuredId = process.env.TOPSTEPX_ACCOUNT_ID
  if (configuredId) {
    const match = accounts.find((a) => String(a.id) === configuredId)
    if (match) return match
  }
  return accounts[0]
}

// ─── POSITIONS ────────────────────────────────────────────────────────────────
export interface TSXPosition {
  id: number
  accountId: number
  contractId: string
  creationTimestamp: string
  type: number  // 1=LONG, 2=SHORT
  size: number
  averagePrice: number
}

export async function getOpenPositions(accountId: number): Promise<TSXPosition[]> {
  const data = await apiPost<{ positions: TSXPosition[] }>('/api/Position/searchOpen', { accountId })
  return data.positions ?? []
}

// ─── CONTRACTS ────────────────────────────────────────────────────────────────
export interface TSXContract {
  id: string
  name: string
  description?: string
  tickSize?: number
  tickValue?: number
}

export async function searchContracts(text: string, live = true): Promise<TSXContract[]> {
  try {
    const data = await apiPost<{ contracts: TSXContract[] }>('/api/Contract/search', { searchText: text, live })
    return data.contracts ?? []
  } catch {
    return []
  }
}

// Build front-month contract ID using CME quarterly codes: Mar=H, Jun=M, Sep=U, Dec=Z
function buildFrontMonthContractId(symbol: string): string {
  const now = new Date()
  const month = now.getUTCMonth() + 1
  const yearFull = now.getUTCFullYear()
  const cmeMonths: Record<number, string> = { 3: 'H', 6: 'M', 9: 'U', 12: 'Z' }
  const quarterlyMonths = [3, 6, 9, 12]
  let frontMonth = quarterlyMonths.find((m) => m >= month)
  let frontYear = yearFull
  if (!frontMonth) { frontMonth = 3; frontYear = yearFull + 1 }
  const monthCode = cmeMonths[frontMonth]
  return `CON.F.US.${symbol}.${monthCode}${String(frontYear).slice(2)}`
}

export async function getActiveNQContractId(): Promise<string> {
  if (process.env.TOPSTEPX_NQ_CONTRACT_ID) return process.env.TOPSTEPX_NQ_CONTRACT_ID
  const contracts = await searchContracts('NQ', true)
  const nq = contracts.filter((c) => c.id?.includes('CON.F.US.NQ') && !c.id?.includes('MNQ'))
  return nq[0]?.id ?? buildFrontMonthContractId('NQ')
}

export async function getActiveMNQContractId(): Promise<string> {
  if (process.env.TOPSTEPX_MNQ_CONTRACT_ID) return process.env.TOPSTEPX_MNQ_CONTRACT_ID
  const contracts = await searchContracts('MNQ', true)
  const mnq = contracts.filter((c) => c.id?.includes('CON.F.US.MNQ'))
  return mnq[0]?.id ?? buildFrontMonthContractId('MNQ')
}

// ─── HISTORICAL BARS ──────────────────────────────────────────────────────────
export interface TSXBar { t: string; o: number; h: number; l: number; c: number; v: number }

export async function getMinuteBars(
  contractId: string, startTime: Date, endTime: Date, live = true, limit = 100
): Promise<TSXBar[]> {
  const data = await apiPost<{ bars: TSXBar[] }>('/api/History/retrieveBars', {
    contractId, live,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    unit: 2, unitNumber: 1, limit,
    includePartialBar: false,
  })
  return (data.bars ?? []).sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
}

// ─── OPENING RANGE CALCULATOR ─────────────────────────────────────────────────
export interface ORBResult {
  orHigh: number
  orLow: number
  orSize: number
  barsUsed: number
  startTime: string
  endTime: string
  currentPrice: number
  breakoutLong: boolean
  breakoutShort: boolean
  breakoutDirection: 'LONG' | 'SHORT' | 'NONE'
  contractId: string
}

export async function calculateOpeningRange(symbol: 'NQ' | 'MNQ' = 'NQ', live = true): Promise<ORBResult> {
  const contractId = symbol === 'NQ' ? await getActiveNQContractId() : await getActiveMNQContractId()

  // Get ET offset dynamically
  const now = new Date()
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const etOffsetHours = Math.round((now.getTime() - etNow.getTime()) / (3600 * 1000))

  // Build 9:30 AM ET in UTC
  const orStart = new Date(now)
  orStart.setUTCHours(9 + etOffsetHours, 30, 0, 0)
  // If today's 9:30 hasn't happened yet UTC-wise, go to yesterday
  if (orStart > now) orStart.setUTCDate(orStart.getUTCDate() - 1)

  const orEnd = new Date(orStart.getTime() + 30 * 60 * 1000) // +30 min = 10:00 AM ET

  const bars = await getMinuteBars(contractId, orStart, orEnd, live, 35)
  if (!bars.length) throw new Error(`No bars for ${contractId} in OR window`)

  const orHigh = Math.max(...bars.map((b) => b.h))
  const orLow  = Math.min(...bars.map((b) => b.l))
  const orSize = orHigh - orLow
  const lastBar = bars[bars.length - 1]
  const currentPrice = lastBar.c

  const BREAKOUT_BUFFER = 3
  const breakoutLong  = currentPrice > orHigh + BREAKOUT_BUFFER
  const breakoutShort = currentPrice < orLow  - BREAKOUT_BUFFER

  return {
    orHigh, orLow, orSize: parseFloat(orSize.toFixed(2)),
    barsUsed: bars.length,
    startTime: bars[0].t, endTime: lastBar.t,
    currentPrice, breakoutLong, breakoutShort,
    breakoutDirection: breakoutLong ? 'LONG' : breakoutShort ? 'SHORT' : 'NONE',
    contractId,
  }
}

// ─── CONNECTION TEST ──────────────────────────────────────────────────────────
export async function testConnection(): Promise<{ connected: boolean; account: TSXAccount | null; error?: string }> {
  try {
    const account = await getPrimaryAccount()
    return { connected: true, account }
  } catch (err) {
    return { connected: false, account: null, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── STATUS PING ──────────────────────────────────────────────────────────────
// GET /api/Status/Ping — unauthenticated, just checks if the API is reachable
export async function pingAPI(): Promise<{ reachable: boolean; latencyMs: number }> {
  const t0 = Date.now()
  try {
    const res = await fetch(`${BASE_URL}/api/Status/Ping`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    return { reachable: res.ok || res.status === 401, latencyMs: Date.now() - t0 }
  } catch {
    return { reachable: false, latencyMs: Date.now() - t0 }
  }
}

// ─── TOKEN VALIDATION / REFRESH ───────────────────────────────────────────────
// POST /api/Auth/validate — refreshes token without re-logging in
export async function validateAndRefreshToken(): Promise<string> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 30 * 60 * 1000) {
    // Try to refresh via validate endpoint first
    try {
      const res = await fetch(`${BASE_URL}/api/Auth/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${_tokenCache.token}`,
        },
        body: JSON.stringify({}),
        cache: 'no-store',
      })
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.newToken) {
          _tokenCache = { token: data.newToken, expiresAt: Date.now() + 23.5 * 60 * 60 * 1000 }
          return data.newToken
        }
      }
    } catch {}
    // Fall back to existing cached token
    return _tokenCache.token
  }
  // Full re-login
  return getTopstepXToken()
}

// ─── TRADES (FILL HISTORY) ────────────────────────────────────────────────────
export interface TSXTrade {
  id: number
  accountId: number
  contractId: string
  creationTimestamp: string
  price: number
  profitAndLoss: number
  fees: number
  side: number     // 0=BUY, 1=SELL
  size: number
  orderId?: number
}

export async function getTrades(
  accountId: number,
  startTime?: Date,
  endTime?: Date,
  limit = 100
): Promise<TSXTrade[]> {
  const body: Record<string, unknown> = { accountId, limit }
  if (startTime) body.startTimestamp = startTime.toISOString()
  if (endTime)   body.endTimestamp   = endTime.toISOString()
  const data = await apiPost<{ trades: TSXTrade[] }>('/api/Trade/search', body)
  return (data.trades ?? []).sort(
    (a, b) => new Date(b.creationTimestamp).getTime() - new Date(a.creationTimestamp).getTime()
  )
}

export async function getTodayTrades(accountId: number): Promise<TSXTrade[]> {
  const startTime = new Date()
  startTime.setUTCHours(0, 0, 0, 0)
  return getTrades(accountId, startTime, undefined, 200)
}

// ─── ORDER EXECUTION — PERMANENTLY DISABLED ──────────────────────────────────
export function placeOrder(): never  { throw new Error('⛔ ORDER EXECUTION IS PERMANENTLY DISABLED.') }
export function cancelOrder(): never { throw new Error('⛔ ORDER EXECUTION IS PERMANENTLY DISABLED.') }
export function modifyOrder(): never { throw new Error('⛔ ORDER EXECUTION IS PERMANENTLY DISABLED.') }
