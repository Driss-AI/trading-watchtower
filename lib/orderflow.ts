// ─── ORDER-FLOW AGGREGATION ─────────────────────────────────────────────────
// Turns the raw TopStepX trade tape (GatewayTrade) and DOM (GatewayDepth) into
// the two signals an ORB breakout actually needs to avoid sweeps/traps:
//
//   1. Delta  — net aggressive buying vs. selling. A breakout NOT backed by
//               delta in its direction is suspect (the start of a sweep).
//   2. DOM    — resting liquidity just beyond the OR boundary. A large opposing
//               wall the breakout must eat through = absorption / trap risk.
//
// assessBreakout() folds these into a verdict (confirm / caution / veto).
//
// SAFETY POLICY: decision-time data must be fresh. If trades or DOM are stale
// or missing at the moment of a breakout, the verdict is 'caution' with
// available=false. The AI then sees explicit "orderflow unavailable" and per
// the system-prompt CAUTION rule must require strong conviction or size down /
// skip. The engine never auto-confirms a breakout when it cannot see the tape.
//
// Thresholds below are initial heuristics — they should be tuned against live
// MNQ data. The hard veto only fires on egregious cases by design.

import {
  subscribeToTradesAndDepth,
  registerTradeSink,
  registerDepthSink,
  getLastQuote,
} from './topstepx-ws'

// ─── RAW PAYLOAD SHAPES (confirmed from the live probe) ─────────────────────
interface RawTrade { price?: number; volume?: number; type?: number } // type 0=Buy,1=Sell (aggressor)
interface RawDepth { price?: number; volume?: number }                 // resting volume at a price level

// ─── TUNABLES ────────────────────────────────────────────────────────────────
export const SHORT_WINDOW_MS = 90_000  // rolling delta window
const STALE_MS               = 12_000  // no prints for this long → data unavailable
const DELTA_STRONG           = 250     // |net contracts| opposite the break → strong divergence
const DELTA_MILD             = 80      // → mild divergence
const WALL_BAND_PTS          = 6       // price band beyond the level we inspect for a wall
const WALL_RATIO_HIGH        = 2.5     // opposing/own resting-vol ratio → high absorption risk
const WALL_RATIO_MODERATE    = 1.5     // → moderate
const WALL_MIN_VOLUME        = 400     // floor so thin books don't trip the wall flag
const BOOK_PRUNE_PTS         = 40      // drop book levels further than this from last price

// ─── STATE ─────────────────────────────────────────────────────────────────
interface SignedPrint { at: number; signed: number }

let _activeContract = ''
let _cumDelta = 0
let _recent: SignedPrint[] = []
let _lastTradeAt = 0
const _book = new Map<number, number>() // price → resting volume
let _wired = false

// ─── INGEST ──────────────────────────────────────────────────────────────────

function asArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === 'object') return [raw as T]
  return []
}

export function ingestTrades(raw: unknown): void {
  const prints = asArray<RawTrade>(raw)
  const now = Date.now()
  for (const p of prints) {
    const vol = Number(p.volume ?? 0)
    if (!(vol > 0) || p.type == null) continue
    const signed = p.type === 0 ? vol : -vol // Buy aggressor lifts ask = +, Sell hits bid = -
    _cumDelta += signed
    _recent.push({ at: now, signed })
    _lastTradeAt = now
  }
  pruneRecent(now)
}

export function ingestDepth(raw: unknown): void {
  const levels = asArray<RawDepth>(raw)
  const ref = currentRef()
  for (const lvl of levels) {
    const price = Number(lvl.price ?? 0)
    if (!(price > 0)) continue
    const vol = Number(lvl.volume ?? 0)
    if (vol > 0) _book.set(price, vol)
    else _book.delete(price)
  }
  if (ref > 0) {
    for (const price of Array.from(_book.keys())) {
      if (Math.abs(price - ref) > BOOK_PRUNE_PTS) _book.delete(price)
    }
  }
}

function pruneRecent(now: number): void {
  const cutoff = now - SHORT_WINDOW_MS
  if (_recent.length && _recent[0].at < cutoff) {
    _recent = _recent.filter((p) => p.at >= cutoff)
  }
}

// Best estimate of "current price" for side classification: quote mid, else last trade ref.
function currentRef(): number {
  const q = _activeContract ? getLastQuote(_activeContract) : null
  if (q) {
    if (q.bid > 0 && q.ask > 0) return (q.bid + q.ask) / 2
    if (q.price > 0) return q.price
  }
  return 0
}

// ─── QUERIES ─────────────────────────────────────────────────────────────────

export function getShortDelta(windowMs = SHORT_WINDOW_MS): number {
  const cutoff = Date.now() - windowMs
  let sum = 0
  for (const p of _recent) if (p.at >= cutoff) sum += p.signed
  return sum
}

export function getCumDelta(): number {
  return _cumDelta
}

function isStale(): boolean {
  return _lastTradeAt === 0 || Date.now() - _lastTradeAt > STALE_MS
}

// Sum resting book volume in a price band [lo, hi].
function bandVolume(lo: number, hi: number): number {
  let sum = 0
  for (const [price, vol] of Array.from(_book.entries())) if (price >= lo && price <= hi) sum += vol
  return sum
}

// ─── ASSESSMENT ────────────────────────────────────────────────────────────

export type OrderflowVerdict = 'confirm' | 'caution' | 'veto'

export interface OrderflowAssessment {
  available: boolean
  cumDelta: number
  shortDelta: number
  deltaConfirms: boolean
  divergence: 'none' | 'mild' | 'strong'
  resistanceVol: number
  supportVol: number
  wallRisk: 'none' | 'moderate' | 'high'
  verdict: OrderflowVerdict
  reasons: string[]
}

// Evaluate a breakout against live order flow. FAIL-CLOSED: unavailable → caution
// (the AI must affirm without flow data, and the system-prompt CAUTION rule
// applies — strong conviction required or size down / skip).
export function assessBreakout(
  direction: 'LONG' | 'SHORT',
  refPrice: number,
): OrderflowAssessment {
  const cumDelta = _cumDelta
  const shortDelta = getShortDelta()

  if (isStale() || refPrice <= 0) {
    return {
      available: false, cumDelta, shortDelta,
      deltaConfirms: false, divergence: 'none',
      resistanceVol: 0, supportVol: 0, wallRisk: 'none',
      verdict: 'caution',
      reasons: ['order flow unavailable/stale — caution (fail-closed: brain must affirm without flow data)'],
    }
  }

  const reasons: string[] = []

  // ── Delta: does aggressive flow back the break direction? ──
  const wantSign = direction === 'LONG' ? 1 : -1
  const aligned = Math.sign(shortDelta) === wantSign || shortDelta === 0
  const against = shortDelta * wantSign // negative when delta opposes the break
  let divergence: OrderflowAssessment['divergence'] = 'none'
  if (against <= -DELTA_STRONG) divergence = 'strong'
  else if (against <= -DELTA_MILD) divergence = 'mild'

  if (divergence === 'strong') reasons.push(`strong delta divergence (${shortDelta} net into a ${direction})`)
  else if (divergence === 'mild') reasons.push(`mild delta divergence (${shortDelta} net)`)
  else if (aligned && Math.abs(shortDelta) >= DELTA_MILD) reasons.push(`delta confirms (${shortDelta} net)`)

  // ── DOM: is a wall absorbing the move just beyond the level? ──
  const resistanceVol = direction === 'LONG'
    ? bandVolume(refPrice + 0.01, refPrice + WALL_BAND_PTS)   // asks above
    : bandVolume(refPrice - WALL_BAND_PTS, refPrice - 0.01)   // bids below
  const supportVol = direction === 'LONG'
    ? bandVolume(refPrice - WALL_BAND_PTS, refPrice - 0.01)
    : bandVolume(refPrice + 0.01, refPrice + WALL_BAND_PTS)

  const ratio = resistanceVol / Math.max(supportVol, 1)
  let wallRisk: OrderflowAssessment['wallRisk'] = 'none'
  if (resistanceVol >= WALL_MIN_VOLUME && ratio >= WALL_RATIO_HIGH) wallRisk = 'high'
  else if (resistanceVol >= WALL_MIN_VOLUME && ratio >= WALL_RATIO_MODERATE) wallRisk = 'moderate'

  if (wallRisk === 'high') reasons.push(`heavy resting wall ahead (${resistanceVol} vs ${supportVol}, ${ratio.toFixed(1)}x)`)
  else if (wallRisk === 'moderate') reasons.push(`moderate resting wall ahead (${ratio.toFixed(1)}x)`)

  // ── Verdict ──
  let verdict: OrderflowVerdict = 'confirm'
  if (divergence === 'strong' || wallRisk === 'high') verdict = 'veto'
  else if (divergence === 'mild' || wallRisk === 'moderate') verdict = 'caution'

  if (!reasons.length) reasons.push('order flow neutral')

  return {
    available: true, cumDelta, shortDelta,
    deltaConfirms: aligned, divergence,
    resistanceVol, supportVol, wallRisk,
    verdict, reasons,
  }
}

export interface OrderflowLive {
  refPrice: number
  long: OrderflowAssessment
  short: OrderflowAssessment
}

// Two-sided read at the current price — "if price broke here right now, what
// would the engine see?" Lets the cockpit show live flow even with no breakout.
export function assessLive(): OrderflowLive | null {
  const ref = currentRef()
  if (!ref || ref <= 0) return null
  return { refPrice: ref, long: assessBreakout('LONG', ref), short: assessBreakout('SHORT', ref) }
}

export interface OrderflowSnapshot {
  available: boolean
  contractId: string
  cumDelta: number
  shortDelta: number
  bookLevels: number
  lastTradeAgoMs: number | null
  bestBid: number | null
  bestAsk: number | null
  live: OrderflowLive | null
}

export function getOrderflowSnapshot(): OrderflowSnapshot {
  const q = _activeContract ? getLastQuote(_activeContract) : null
  return {
    available: !isStale(),
    contractId: _activeContract,
    cumDelta: _cumDelta,
    shortDelta: getShortDelta(),
    bookLevels: _book.size,
    lastTradeAgoMs: _lastTradeAt ? Date.now() - _lastTradeAt : null,
    bestBid: q && q.bid > 0 ? q.bid : null,
    bestAsk: q && q.ask > 0 ? q.ask : null,
    live: assessLive(),
  }
}

// ─── LIFECYCLE ─────────────────────────────────────────────────────────────

// Subscribe to the contract's trades + depth and start aggregating. Idempotent
// across Next.js module contexts (guarded on globalThis).
export async function startOrderflow(contractId: string): Promise<void> {
  _activeContract = contractId

  const g = globalThis as Record<string, unknown>
  if (!_wired && !g.__orderflowWired) {
    _wired = true
    g.__orderflowWired = true
    registerTradeSink((cid, raw) => { if (cid === _activeContract) ingestTrades(raw) })
    registerDepthSink((cid, raw) => { if (cid === _activeContract) ingestDepth(raw) })
    console.log('[Orderflow] Sinks registered')
  }

  await subscribeToTradesAndDepth(contractId)
  console.log(`[Orderflow] Aggregating ${contractId}`)
}

// Reset accumulators on a new trading day.
export function resetOrderflowDay(): void {
  _cumDelta = 0
  _recent = []
  _lastTradeAt = 0
  _book.clear()
}
