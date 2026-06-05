// ─── BACKTEST — PURE REPLAY ─────────────────────────────────────────────────
// Replays historical 1-min bars through the SAME pure evaluateSignal() that
// paper and live use. No I/O: bars come in as data, decisions + simulated
// outcomes come out. Mirrors the paper engine's semantics exactly:
//
//   1. Opening range = high/low of the first `orMinutes` bars from OR start.
//   2. Arm a break when a bar CLOSES beyond OR boundary + buffer.
//   3. Evaluate on the NEXT closed bar (wait-for-close), refPrice = that close.
//      - If that bar closes back inside the OR → false break, no trade.
//   4. evaluateSignal(state, { skipAI: true }) with orderflow 'missing' →
//      DEGRADED gate set (mechanical only). Honest about what history supports.
//   5. On a TAKE, simulate the fill + intrabar walk to stop/target with
//      conservative stop-first tie-breaking, slippage, and round-trip fees.
//
// One break per session (paper arms one pending break at a time; the first
// confirmed break in the trade window is the day's signal).

import { evaluateSignal } from '../signal-engine'
import { POINT_VALUES } from '../scoring'
import type { SignalState, BreakBar, RecentBars } from '../signal-engine/types'
import type {
  BacktestBar,
  BacktestConfig,
  BacktestTrade,
  ReplayedSignal,
  SessionBars,
  SessionReplay,
  TradeOutcome,
  ExitReason,
} from './types'

const RECENT_BAR_COUNT = 100
const AVG_VOLUME_WINDOW = 20

// ── ET minute-of-day for a bar's OPEN time, DST-aware via Intl. ──
function etMinutesOfDay(msEpoch: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(msEpoch))
  const p: Record<string, string> = {}
  for (const { type, value } of parts) p[type] = value
  let hh = parseInt(p.hour, 10)
  if (hh === 24) hh = 0 // Intl can emit 24 at midnight
  return hh * 60 + parseInt(p.minute, 10)
}

function toBreakBar(b: BacktestBar): BreakBar {
  return { open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, ticks: 0, time: b.t }
}

function avgVolume(bars: BacktestBar[], endIdxExclusive: number): number {
  const start = Math.max(0, endIdxExclusive - AVG_VOLUME_WINDOW)
  const slice = bars.slice(start, endIdxExclusive)
  if (!slice.length) return 0
  return slice.reduce((s, b) => s + b.v, 0) / slice.length
}

/** Build the SignalState for a decision bar — the degraded (no-orderflow) shape. */
function buildState(
  cfg: BacktestConfig,
  date: string,
  direction: 'LONG' | 'SHORT',
  orHigh: number,
  orLow: number,
  refPrice: number,
  decisionBar: BacktestBar,
  recentRaw: BacktestBar[],
): SignalState {
  const orSize = orHigh - orLow
  const stopPrice = direction === 'LONG' ? orLow : orHigh
  const targetPrice = direction === 'LONG'
    ? refPrice + orSize * cfg.targetMultiple
    : refPrice - orSize * cfg.targetMultiple

  const recent: RecentBars = {
    bars: recentRaw.map(toBreakBar),
    avgVolume20: avgVolume(recentRaw, recentRaw.length),
  }

  return {
    date,
    barTime: decisionBar.t,
    market: cfg.market,
    decisionPoint: 'breakout',
    direction,
    orHigh,
    orLow,
    orSize,
    bufferPoints: cfg.bufferPoints,
    refPrice,
    stopPrice,
    targetPrice,
    targetMultiple: cfg.targetMultiple,
    account: {
      dailyPnl: 0,
      tradesCount: 0,
      lossesCount: 0,
      dailyLossLimit: cfg.dailyLossLimit,
      trailingDrawdownRemaining: cfg.dailyLossLimit * 2,
      maxContractsConfig: cfg.maxContractsConfig,
    },
    structural: {
      vwap: null, vwapDistance: null,
      priorDayHigh: null, priorDayLow: null,
      overnightHigh: null, overnightLow: null,
    },
    prior: { preSession: null, orAssessment: null },
    breakBar: toBreakBar(decisionBar),
    recent,
    // ── DEGRADED: order flow is not replayable from history ──
    orderflow: {
      available: false,
      verdict: 'caution',
      cumDelta: 0, shortDelta: 0, deltaConfirms: false,
      divergence: 'none', wallRisk: 'none',
      resistanceVol: 0, supportVol: 0,
      reasons: ['order flow unavailable — backtest degraded gate set'],
    },
    candleFreshness: 'fresh',
    orderflowFreshness: 'missing',
    macroFreshness: 'missing',
    accountFreshness: 'fresh',
    config: { enablePatternGate: true, enableVolumeGate: true, enableOrderflowVeto: true },
  }
}

// ── Simulate fill + intrabar walk to stop/target. Conservative: if a single
// bar's range spans BOTH stop and target, assume the stop hit first (worst
// case). Slippage worsens the entry and the stop exit; fees applied per RT. ──
function simulateTrade(
  cfg: BacktestConfig,
  date: string,
  direction: 'LONG' | 'SHORT',
  refPrice: number,
  stop: number,
  target: number,
  contracts: number,
  forwardBars: BacktestBar[],
): BacktestTrade {
  const pointValue = POINT_VALUES[cfg.market] ?? 2
  const slip = cfg.slippagePoints
  // Adverse entry slippage: pay up on a LONG, sell lower on a SHORT.
  const entry = direction === 'LONG' ? refPrice + slip : refPrice - slip
  const riskPts = Math.abs(entry - stop)

  let exitPrice = forwardBars.length ? forwardBars[forwardBars.length - 1].c : refPrice
  let exitTime = forwardBars.length ? forwardBars[forwardBars.length - 1].t : refPrice
  let exitReason: ExitReason = 'eod'
  let barsHeld = forwardBars.length

  for (let i = 0; i < forwardBars.length; i++) {
    const b = forwardBars[i]
    const hitStop = direction === 'LONG' ? b.l <= stop : b.h >= stop
    const hitTarget = direction === 'LONG' ? b.h >= target : b.l <= target
    if (hitStop) {
      // Stop fills with adverse slippage; stop-first on an ambiguous bar.
      exitPrice = direction === 'LONG' ? stop - slip : stop + slip
      exitReason = 'stop'; exitTime = b.t; barsHeld = i + 1
      break
    }
    if (hitTarget) {
      exitPrice = target // limit fill, no adverse slippage at target
      exitReason = 'target'; exitTime = b.t; barsHeld = i + 1
      break
    }
  }

  const resultPts = direction === 'LONG' ? exitPrice - entry : entry - exitPrice
  const grossDollars = resultPts * pointValue * contracts
  const fees = cfg.feesPerRoundTrip * contracts
  const resultDollars = grossDollars - fees
  const riskDollars = riskPts * pointValue * contracts
  const resultR = riskDollars > 0 ? resultDollars / riskDollars : 0
  const outcome: TradeOutcome = resultDollars > 0 ? 'win' : resultDollars < 0 ? 'loss' : 'be'

  return {
    date, barTime: forwardBars.length ? forwardBars[0].t : refPrice,
    direction, entry, stop, target,
    exitPrice, exitTime, barsHeld, contracts,
    resultPts, resultDollars, resultR, outcome, exitReason,
  }
}

/** Replay a single session. Pure. Returns the session's decision + sim outcome. */
export async function replaySession(
  cfg: BacktestConfig,
  session: SessionBars,
): Promise<SessionReplay> {
  const bars = session.bars
  const none = (reason: string): SessionReplay => ({
    date: session.date, orHigh: null, orLow: null, signal: null, reason,
  })
  if (bars.length < 2) return none('insufficient bars')

  // ── OR window: bars whose OPEN is within [orStart, orStart + orMinutes) ET ──
  const orStart = cfg.orStartMinutesET
  const orEnd = orStart + cfg.orMinutes
  const orBars = bars.filter((b) => {
    const m = etMinutesOfDay(b.t)
    return m >= orStart && m < orEnd
  })
  if (orBars.length === 0) return none('no OR-window bars')

  const orHigh = Math.max(...orBars.map((b) => b.h))
  const orLow = Math.min(...orBars.map((b) => b.l))

  // ── Walk bars after the OR window; arm on a close beyond OR+buffer, then
  // evaluate on the NEXT closed bar. One signal per session. ──
  const longTrigger = orHigh + cfg.bufferPoints
  const shortTrigger = orLow - cfg.bufferPoints

  let armed: 'LONG' | 'SHORT' | null = null
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    const m = etMinutesOfDay(bar.t)
    if (m < orEnd) continue // skip OR-window bars themselves
    if (m >= cfg.tradeWindowEndMinutesET) break // past trade window — no new arms

    if (armed === null) {
      if (bar.c > longTrigger) armed = 'LONG'
      else if (bar.c < shortTrigger) armed = 'SHORT'
      continue // never evaluate the same bar we armed on
    }

    // We have an armed break and this is the next closed bar → decide.
    const direction = armed
    const refPrice = bar.c

    // False break: close came back inside the OR.
    const insideLong = direction === 'LONG' && bar.c <= orHigh
    const insideShort = direction === 'SHORT' && bar.c >= orLow
    if (insideLong || insideShort) {
      return { date: session.date, orHigh, orLow, signal: null, reason: 'false break — closed back inside OR' }
    }

    const recentRaw = bars.slice(Math.max(0, i - RECENT_BAR_COUNT + 1), i + 1)
    const state = buildState(cfg, session.date, direction, orHigh, orLow, refPrice, bar, recentRaw)
    const decision = await evaluateSignal(state, { skipAI: true })

    let trade: BacktestTrade | null = null
    if (decision.finalDecision === 'take') {
      trade = simulateTrade(
        cfg, session.date, direction,
        refPrice, decision.stop, decision.target,
        decision.finalContracts, bars.slice(i + 1),
      )
    }

    const signal: ReplayedSignal = { date: session.date, barTime: bar.t, direction, decision, trade }
    return { date: session.date, orHigh, orLow, signal, reason: null }
  }

  return { date: session.date, orHigh, orLow, signal: null, reason: 'no confirmed break in trade window' }
}

/** Replay a range of sessions. Pure (given bars). */
export async function replayRange(
  cfg: BacktestConfig,
  sessions: SessionBars[],
): Promise<SessionReplay[]> {
  const out: SessionReplay[] = []
  for (const s of sessions) out.push(await replaySession(cfg, s))
  return out
}
