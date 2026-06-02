// ─── BACKTEST — TYPES ───────────────────────────────────────────────────────
// Contracts for the historical replay. Replay reuses the SAME pure
// evaluateSignal() as paper/live, fed a SignalState built from history instead
// of live globals. The order-flow gate is NOT replayable from TopstepX history,
// so backtest runs a DEGRADED gate set: orderflow is marked 'missing' and the
// AI is skipped (skipAI), so what we measure is the mechanical edge alone
// (ORB structure + pattern + volume + risk math). See lib/backtest/replay.ts.

import type { SignalDecision } from '../signal-engine/types'

/** One 1-minute OHLCV bar, time as ms epoch (UTC). */
export interface BacktestBar {
  t: number // ms epoch, bar OPEN time
  o: number
  h: number
  l: number
  c: number
  v: number
}

/** Bars for a single NY trading day, already grouped by the data loader. */
export interface SessionBars {
  date: string // YYYY-MM-DD (NY date)
  bars: BacktestBar[] // ascending by time
}

export interface BacktestConfig {
  market: string // 'MNQ' / 'NQ'
  orMinutes: number // opening-range length (paper uses 15)
  bufferPoints: number // breakout buffer beyond OR boundary
  targetMultiple: number // target = refPrice ± orSize × this
  orStartMinutesET: number // OR window start, ET minutes-of-day (9:30 = 570)
  tradeWindowEndMinutesET: number // stop arming new breaks after this (11:00 = 660)
  slippagePoints: number // adverse fill slippage applied to entry + stop exits
  feesPerRoundTrip: number // $ commission per contract per round trip
  dailyLossLimit: number // account risk budget (for sizing math)
  maxContractsConfig: number // engine contract cap (1-5)
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  market: 'MNQ',
  orMinutes: 15,
  bufferPoints: 3,
  targetMultiple: 1.5,
  orStartMinutesET: 9 * 60 + 30, // 09:30 ET
  tradeWindowEndMinutesET: 11 * 60, // 11:00 ET
  slippagePoints: 0.5, // 2 ticks on MNQ (tick = 0.25)
  feesPerRoundTrip: 1.34,
  dailyLossLimit: 1000,
  maxContractsConfig: 5,
}

export type TradeOutcome = 'win' | 'loss' | 'be'
export type ExitReason = 'target' | 'stop' | 'eod'

/** A simulated fill+exit for a TAKE decision. R is fee- and slippage-adjusted
 *  and contract-count-independent, so the degraded CAUTION 2-cap doesn't bias it. */
export interface BacktestTrade {
  date: string
  barTime: number // decision bar close time
  direction: 'LONG' | 'SHORT'
  entry: number // refPrice + adverse slippage
  stop: number
  target: number
  exitPrice: number
  exitTime: number
  barsHeld: number
  contracts: number
  resultPts: number // gross points (exit vs entry, direction-signed)
  resultDollars: number // net $ after fees
  resultR: number // net R = resultDollars / (riskPts × pointValue × contracts)
  outcome: TradeOutcome
  exitReason: ExitReason
}

/** One evaluated opportunity from the replay (taken or skipped). */
export interface ReplayedSignal {
  date: string
  barTime: number
  direction: 'LONG' | 'SHORT'
  decision: SignalDecision
  trade: BacktestTrade | null // null when skipped
}

export interface SessionReplay {
  date: string
  orHigh: number | null
  orLow: number | null
  signal: ReplayedSignal | null
  reason: string | null // why no signal (e.g. 'no OR bars', 'no break in window')
}

export interface BacktestResult {
  config: BacktestConfig
  startDate: string
  endDate: string
  sessions: SessionReplay[]
  signals: ReplayedSignal[]
  trades: BacktestTrade[]
}

export interface BacktestMetrics {
  totalSignals: number // opportunities evaluated (takes + skips)
  totalTrades: number // takes only
  wins: number
  losses: number
  breakeven: number
  winRate: number // 0..1 over trades
  totalR: number
  expectancyR: number // avg R per trade
  profitFactor: number // grossWinR / |grossLossR|
  avgWinR: number
  avgLossR: number
  maxDrawdownR: number
  maxLosingStreak: number
}

export interface SplitMetrics {
  all: BacktestMetrics
  inSample: BacktestMetrics
  outOfSample: BacktestMetrics
  splitDate: string | null
}
