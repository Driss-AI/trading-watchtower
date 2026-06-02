// ─── BACKTEST — METRICS (PURE) ──────────────────────────────────────────────
// Aggregate stats over simulated trades. All R-based so contract-count and the
// degraded CAUTION 2-cap don't bias results. Plus an in-sample / out-of-sample
// split so we never judge an edge only on the data we'd "fit" to.

import type {
  BacktestTrade,
  BacktestMetrics,
  ReplayedSignal,
  SessionReplay,
  SplitMetrics,
} from './types'

const EMPTY: BacktestMetrics = {
  totalSignals: 0, totalTrades: 0, wins: 0, losses: 0, breakeven: 0,
  winRate: 0, totalR: 0, expectancyR: 0, profitFactor: 0,
  avgWinR: 0, avgLossR: 0, maxDrawdownR: 0, maxLosingStreak: 0,
}

/** Compute metrics over a set of trades. `signalCount` carries the taken+skipped
 *  opportunity total (trades alone undercount the engine's activity). */
export function computeMetrics(trades: BacktestTrade[], signalCount?: number): BacktestMetrics {
  if (trades.length === 0) {
    return { ...EMPTY, totalSignals: signalCount ?? 0 }
  }

  let wins = 0, losses = 0, breakeven = 0
  let totalR = 0, grossWinR = 0, grossLossR = 0
  let maxLosingStreak = 0, curLosingStreak = 0
  // Drawdown on the cumulative-R equity curve.
  let cum = 0, peak = 0, maxDrawdownR = 0

  for (const t of trades) {
    totalR += t.resultR
    if (t.outcome === 'win') { wins++; grossWinR += t.resultR; curLosingStreak = 0 }
    else if (t.outcome === 'loss') { losses++; grossLossR += t.resultR; curLosingStreak++; }
    else { breakeven++; curLosingStreak = 0 }
    if (curLosingStreak > maxLosingStreak) maxLosingStreak = curLosingStreak

    cum += t.resultR
    if (cum > peak) peak = cum
    const dd = peak - cum
    if (dd > maxDrawdownR) maxDrawdownR = dd
  }

  const n = trades.length
  const winRate = wins / n
  const expectancyR = totalR / n
  const profitFactor = grossLossR < 0 ? grossWinR / Math.abs(grossLossR) : (grossWinR > 0 ? Infinity : 0)
  const avgWinR = wins > 0 ? grossWinR / wins : 0
  const avgLossR = losses > 0 ? grossLossR / losses : 0

  return {
    totalSignals: signalCount ?? n,
    totalTrades: n,
    wins, losses, breakeven,
    winRate: round(winRate, 4),
    totalR: round(totalR, 3),
    expectancyR: round(expectancyR, 3),
    profitFactor: Number.isFinite(profitFactor) ? round(profitFactor, 3) : profitFactor,
    avgWinR: round(avgWinR, 3),
    avgLossR: round(avgLossR, 3),
    maxDrawdownR: round(maxDrawdownR, 3),
    maxLosingStreak,
  }
}

/** Collect taken trades (in chronological order) from session replays. */
export function tradesFromSessions(sessions: SessionReplay[]): BacktestTrade[] {
  const trades: BacktestTrade[] = []
  for (const s of sessions) {
    if (s.signal?.trade) trades.push(s.signal.trade)
  }
  return trades.sort((a, b) => a.barTime - b.barTime)
}

/** Count evaluated opportunities (taken + skipped). */
export function signalsFromSessions(sessions: SessionReplay[]): ReplayedSignal[] {
  return sessions.filter((s) => s.signal).map((s) => s.signal as ReplayedSignal)
}

/** In-sample / out-of-sample split. Holds out the last `oosFraction` of the
 *  date range (by distinct session date) for OOS validation. */
export function computeSplitMetrics(
  sessions: SessionReplay[],
  oosFraction = 0.33,
): SplitMetrics {
  const signals = signalsFromSessions(sessions)
  const allTrades = tradesFromSessions(sessions)
  const all = computeMetrics(allTrades, signals.length)

  // Split by distinct date so a single day is never straddled across IS/OOS.
  const dates = Array.from(new Set(sessions.map((s) => s.date))).sort()
  if (dates.length < 2) {
    return { all, inSample: all, outOfSample: { ...EMPTY }, splitDate: null }
  }
  const splitIdx = Math.max(1, Math.floor(dates.length * (1 - oosFraction)))
  const splitDate = dates[splitIdx]

  const isSessions = sessions.filter((s) => s.date < splitDate)
  const oosSessions = sessions.filter((s) => s.date >= splitDate)

  const inSample = computeMetrics(
    tradesFromSessions(isSessions), signalsFromSessions(isSessions).length,
  )
  const outOfSample = computeMetrics(
    tradesFromSessions(oosSessions), signalsFromSessions(oosSessions).length,
  )

  return { all, inSample, outOfSample, splitDate }
}

function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}
