// ─── 1-MINUTE CANDLE AGGREGATION ────────────────────────────────────────────
// Server-side bar builder for the paper engine. Pulls the same TopStepX trade
// tape that lib/orderflow.ts uses (via the shared registerTradeSink) and
// aggregates ticks into closed 1-minute OHLCV bars. Fail-open like orderflow:
// if the tape goes stale, latest closed bar is whatever was last produced —
// callers MUST check staleness via `isStale()` before treating a bar as fresh.
//
// Two consumers:
//   1. The engine's wait-for-close gate (lib/paper-engine.ts) — looks at the
//      just-closed bar to run pattern + volume checks.
//   2. detectPattern() from lib/patterns.ts — already used by the cockpit
//      CandleReader; the engine reuses the same function on server-side bars.

import {
  subscribeToTradesAndDepth,
  registerTradeSink,
} from './topstepx-ws'
import type { Candle } from './patterns'

// ─── TUNABLES ────────────────────────────────────────────────────────────────
const BAR_MS         = 60_000   // 1-minute bars
const MAX_HISTORY    = 60       // keep the last hour of closed bars
const STALE_MS       = 12_000   // no trades for this long → tape stale

// ─── CANDLE TYPES ────────────────────────────────────────────────────────────

// EngineCandle extends the UI Candle interface with a server-side volume sum.
// The pattern library only reads OHLC + ticks, so passing EngineCandles to
// detectPattern() works unchanged.
export interface EngineCandle extends Candle {
  volume: number
}

interface RawTrade { price?: number; volume?: number; type?: number }

// ─── STATE ───────────────────────────────────────────────────────────────────

let _activeContract = ''
let _wired = false
let _closed: EngineCandle[] = []
let _current: EngineCandle | null = null
let _lastTradeAt = 0

// ─── INGEST ──────────────────────────────────────────────────────────────────

function barStart(ts: number): number {
  return Math.floor(ts / BAR_MS) * BAR_MS
}

function asArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === 'object') return [raw as T]
  return []
}

export function ingestTrades(raw: unknown): void {
  const prints = asArray<RawTrade>(raw)
  const now = Date.now()
  for (const p of prints) {
    const price = Number(p.price ?? 0)
    const vol = Number(p.volume ?? 0)
    if (!(price > 0) || !(vol > 0)) continue

    const start = barStart(now)
    if (!_current || _current.time !== start) {
      if (_current) {
        _closed.push(_current)
        if (_closed.length > MAX_HISTORY) _closed = _closed.slice(-MAX_HISTORY)
      }
      _current = { open: price, high: price, low: price, close: price, time: start, ticks: 1, volume: vol }
    } else {
      _current.high = Math.max(_current.high, price)
      _current.low = Math.min(_current.low, price)
      _current.close = price
      _current.ticks++
      _current.volume += vol
    }
    _lastTradeAt = now
  }
}

// Roll the in-progress bar forward when minute boundaries pass without trades.
// Without this, a quiet minute would keep the previous bar "open" and the
// pattern gate would never see its close.
function rollIfNeeded(now: number): void {
  if (!_current) return
  const start = barStart(now)
  if (start <= _current.time) return
  _closed.push(_current)
  if (_closed.length > MAX_HISTORY) _closed = _closed.slice(-MAX_HISTORY)
  _current = null
}

// ─── QUERIES ─────────────────────────────────────────────────────────────────

export function isStale(): boolean {
  return _lastTradeAt === 0 || Date.now() - _lastTradeAt > STALE_MS
}

// Latest closed bar, or null if no full bar has formed yet. Roll first so a
// minute boundary that passed silently still produces the bar.
export function getLatestClosedCandle(): EngineCandle | null {
  rollIfNeeded(Date.now())
  return _closed.length > 0 ? _closed[_closed.length - 1] : null
}

// Last N closed bars (newest at the end). Roll first.
export function getRecentCandles(n: number): EngineCandle[] {
  rollIfNeeded(Date.now())
  if (n <= 0) return []
  return _closed.slice(-n)
}

// Live in-progress bar, or null if no trade has come in for the current minute.
export function getLiveCandle(): EngineCandle | null {
  return _current
}

// Average volume across the most recent N closed bars (default 20). Returns 0
// when there isn't enough history; callers should treat 0 as "skip the gate".
export function getAvgVolume(n = 20): number {
  rollIfNeeded(Date.now())
  if (_closed.length === 0) return 0
  const sample = _closed.slice(-n)
  const sum = sample.reduce((s, c) => s + c.volume, 0)
  return sum / sample.length
}

export interface CandleSnapshot {
  available: boolean
  contractId: string
  closedBars: number
  lastTradeAgoMs: number | null
  latestClosed: EngineCandle | null
  live: EngineCandle | null
  avgVolume20: number
}

export function getCandleSnapshot(): CandleSnapshot {
  rollIfNeeded(Date.now())
  return {
    available: !isStale(),
    contractId: _activeContract,
    closedBars: _closed.length,
    lastTradeAgoMs: _lastTradeAt ? Date.now() - _lastTradeAt : null,
    latestClosed: _closed.length > 0 ? _closed[_closed.length - 1] : null,
    live: _current,
    avgVolume20: getAvgVolume(20),
  }
}

// ─── LIFECYCLE ───────────────────────────────────────────────────────────────

// Idempotent across Next.js module contexts (same pattern as lib/orderflow.ts).
export async function startCandles(contractId: string): Promise<void> {
  _activeContract = contractId

  const g = globalThis as Record<string, unknown>
  if (!_wired && !g.__candlesWired) {
    _wired = true
    g.__candlesWired = true
    registerTradeSink((cid, raw) => { if (cid === _activeContract) ingestTrades(raw) })
    console.log('[Candles] Trade sink registered')
  }

  await subscribeToTradesAndDepth(contractId)
  console.log(`[Candles] Aggregating ${contractId}`)
}

export function resetCandlesDay(): void {
  _closed = []
  _current = null
  _lastTradeAt = 0
}
