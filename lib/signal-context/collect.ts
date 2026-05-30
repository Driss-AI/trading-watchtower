// ─── SIGNAL CONTEXT — STATE COLLECTOR ───────────────────────────────────────
// The ONLY I/O layer for the signal engine. Reads from live globals (candles
// and orderflow modules) plus caller-supplied snapshots (settings, account
// state, AI priors, briefing) and assembles a SignalState the pure engine
// can evaluate.
//
// Freshness flags are authoritative: if the candle tape is stale or no closed
// bar exists, the engine must skip. Orderflow staleness → caution (the engine
// elevates to CAUTION; AI must affirm). Macro / account missing → caller's
// problem to surface; engine treats missing freshness as fail-closed for
// decision-time data only.

import { getLatestClosedCandle, getRecentCandles, getAvgVolume, isStale as candleIsStale } from '../candles'
import { assessBreakout } from '../orderflow'
import type { MarketBriefing } from '../market-data'
import type { PreSessionDecision, ORAssessment } from '../trading-ai'
import type {
  SignalState,
  Freshness,
  BreakBar,
  RecentBars,
  OrderflowRead,
  StructuralContext,
} from '../signal-engine/types'

export interface CollectBreakoutSignalInput {
  date: string
  market: string // 'MNQ' / 'NQ'
  direction: 'LONG' | 'SHORT'
  orHigh: number
  orLow: number
  bufferPoints: number
  targetMultiple: number

  // Pricing — refPrice is the close of the break bar (or fallback)
  refPrice: number

  // Account snapshot
  dailyPnl: number
  tradesCount: number
  lossesCount: number
  dailyLossLimit: number
  trailingDrawdownRemaining: number
  maxContractsConfig: number

  // AI priors
  preSession: PreSessionDecision | null
  orAssessment: ORAssessment | null

  // Briefing (for structural context)
  briefing: MarketBriefing | null

  // Engine config toggles
  enablePatternGate: boolean
  enableVolumeGate: boolean
  enableOrderflowVeto: boolean
}

const RECENT_BAR_COUNT = 5

/** Build a SignalState for the breakout decision point. Reads live candle +
 *  orderflow globals; takes the rest as inputs. Returns null if essential
 *  inputs are out of bounds (caller treats null as "cannot decide"). */
export function collectBreakoutSignalState(input: CollectBreakoutSignalInput): SignalState {
  const orSize = input.orHigh - input.orLow

  // Stop = opposite OR boundary. Target = refPrice ± (orSize × multiple).
  const stopPrice = input.direction === 'LONG' ? input.orLow : input.orHigh
  const targetPrice = input.direction === 'LONG'
    ? input.refPrice + orSize * input.targetMultiple
    : input.refPrice - orSize * input.targetMultiple

  // ── Candles ──
  const latest = getLatestClosedCandle()
  const recentBars = getRecentCandles(RECENT_BAR_COUNT)
  const avgVolume20 = getAvgVolume(20)
  const candleFreshness: Freshness = !latest
    ? 'missing'
    : candleIsStale() ? 'stale' : 'fresh'

  const breakBar: BreakBar | null = latest ? {
    open: latest.open, high: latest.high, low: latest.low, close: latest.close,
    volume: latest.volume, ticks: latest.ticks, time: latest.time,
  } : null

  const recent: RecentBars | null = recentBars.length > 0 ? {
    bars: recentBars.map((b) => ({
      open: b.open, high: b.high, low: b.low, close: b.close,
      volume: b.volume, ticks: b.ticks, time: b.time,
    })),
    avgVolume20,
  } : null

  // ── Order flow (assessBreakout returns a verdict with fail-closed staleness) ──
  const ofAssess = assessBreakout(input.direction, input.refPrice)
  const orderflow: OrderflowRead = {
    available: ofAssess.available,
    verdict: ofAssess.verdict,
    cumDelta: ofAssess.cumDelta,
    shortDelta: ofAssess.shortDelta,
    deltaConfirms: ofAssess.deltaConfirms,
    divergence: ofAssess.divergence,
    wallRisk: ofAssess.wallRisk,
    resistanceVol: ofAssess.resistanceVol,
    supportVol: ofAssess.supportVol,
    reasons: ofAssess.reasons,
  }
  const orderflowFreshness: Freshness = ofAssess.available ? 'fresh' : 'stale'

  // ── Structural context (what we can fill today) ──
  const vwap = input.briefing?.vwap ?? null
  const vwapDistance = vwap != null ? input.refPrice - vwap : null
  const overnightHigh = input.briefing?.nq?.overnightHigh ?? null
  const overnightLow = input.briefing?.nq?.overnightLow ?? null
  const structural: StructuralContext = {
    vwap, vwapDistance,
    priorDayHigh: null, priorDayLow: null, // not yet wired — leave for later
    overnightHigh, overnightLow,
  }

  const macroFreshness: Freshness = input.briefing ? 'fresh' : 'missing'
  const accountFreshness: Freshness = Number.isFinite(input.dailyLossLimit) && input.dailyLossLimit > 0
    ? 'fresh'
    : 'missing'

  return {
    date: input.date,
    barTime: breakBar?.time ?? Date.now(),
    market: input.market,
    decisionPoint: 'breakout',

    direction: input.direction,
    orHigh: input.orHigh,
    orLow: input.orLow,
    orSize,
    bufferPoints: input.bufferPoints,

    refPrice: input.refPrice,
    stopPrice,
    targetPrice,
    targetMultiple: input.targetMultiple,

    account: {
      dailyPnl: input.dailyPnl,
      tradesCount: input.tradesCount,
      lossesCount: input.lossesCount,
      dailyLossLimit: input.dailyLossLimit,
      trailingDrawdownRemaining: input.trailingDrawdownRemaining,
      maxContractsConfig: input.maxContractsConfig,
    },
    structural,
    prior: {
      preSession: input.preSession,
      orAssessment: input.orAssessment,
    },

    breakBar,
    recent,
    orderflow,

    candleFreshness,
    orderflowFreshness,
    macroFreshness,
    accountFreshness,

    config: {
      enablePatternGate: input.enablePatternGate,
      enableVolumeGate: input.enableVolumeGate,
      enableOrderflowVeto: input.enableOrderflowVeto,
    },
  }
}
