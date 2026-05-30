// ─── SIGNAL ENGINE — MECHANICAL DECIDE ──────────────────────────────────────
// Pure function. Runs freshness checks, pattern + volume + order-flow gates,
// and risk/sizing math. Produces a MechanicalVerdict the caller uses to decide
// whether to consult the AI (TAKE / CAUTION → consult; SKIP → terminate).
//
// Invariants:
// - No DB, no clock reads, no network, no globals. All inputs from state.
// - Freshness flags on state are authoritative — engine never re-checks I/O.
// - Gate verdicts and reasons are preserved verbatim in the output for audit.

import { evaluatePatternGate, evaluateVolumeGate } from '../breakout-gate'
import { computeSizing } from './sizing'
import type {
  SignalState,
  MechanicalVerdict,
  PatternRead,
  VolumeRead,
  OrderflowRead,
} from './types'

const NEUTRAL_ORDERFLOW: OrderflowRead = {
  available: false,
  verdict: 'caution',
  cumDelta: 0,
  shortDelta: 0,
  deltaConfirms: false,
  divergence: 'none',
  wallRisk: 'none',
  resistanceVol: 0,
  supportVol: 0,
  reasons: ['order flow unavailable — caution (fail-closed)'],
}

const MISSING_PATTERN: PatternRead = {
  verdict: 'neutral',
  patternName: null,
  patternSignal: null,
  patternStrength: null,
  orbContext: null,
  reasons: ['no closed bars — gate neutral'],
}

const MISSING_VOLUME: VolumeRead = {
  verdict: 'neutral',
  breakVolume: 0,
  avgVolume: 0,
  ratio: 0,
  reasons: ['volume baseline unavailable — gate neutral'],
}

export function mechanicalDecide(state: SignalState): MechanicalVerdict {
  // ── Risk math (independent of gates — needed even on skips for the row) ──
  const riskPts = Math.abs(state.refPrice - state.stopPrice)
  const rewardPts = Math.abs(state.targetPrice - state.refPrice)
  const rrRatio = riskPts > 0 ? rewardPts / riskPts : 0
  const sizing = computeSizing({ market: state.market, riskPts, account: state.account })

  // Pattern + volume reads (computed once, returned regardless of outcome).
  const pattern = runPatternRead(state)
  const volume = runVolumeRead(state)
  const orderflow = state.orderflow ?? NEUTRAL_ORDERFLOW

  const base = {
    pattern,
    volume,
    orderflow,
    hardCap: sizing.hardCap,
    mechanicalContracts: sizing.mechanicalContracts,
    riskPts,
    rewardPts,
    rrRatio,
    riskDollarsPerContract: sizing.riskDollarsPerContract,
    dailyBudgetRemaining: sizing.dailyBudgetRemaining,
  }

  // ── Freshness checks (decision-time data only) — fail-closed ──
  if (state.candleFreshness !== 'fresh') {
    return skip(`candle data ${state.candleFreshness}`, base)
  }
  if (state.accountFreshness !== 'fresh') {
    return skip(`account state ${state.accountFreshness}`, base)
  }

  // ── Hard risk-budget exhaustion ──
  if (sizing.hardCap < 1) {
    return skip(
      `risk budget exhausted (cap=${sizing.hardCap}, reason=${sizing.capReason})`,
      base,
    )
  }
  if (sizing.dailyBudgetRemaining <= 0) {
    return skip('daily loss budget exhausted', base)
  }

  // ── Gate vetoes (engine config can disable any individual gate) ──
  if (state.config.enablePatternGate && pattern.verdict === 'veto') {
    return skip(`pattern veto — ${pattern.reasons.join(' — ')}`, base)
  }
  if (state.config.enableVolumeGate && volume.verdict === 'veto') {
    return skip(`volume veto — ${volume.reasons.join(' — ')}`, base)
  }
  if (state.config.enableOrderflowVeto && orderflow.verdict === 'veto') {
    return skip(`orderflow veto — ${orderflow.reasons.join('; ')}`, base)
  }

  // ── Order-flow caution (fail-closed unavailable lands here too) ──
  // We don't skip mechanically — we elevate the combined verdict so finalize()
  // requires the AI to explicitly approve, and downsizes if it does.
  const cautionSources: string[] = []
  if (pattern.verdict === 'caution') cautionSources.push('pattern')
  if (volume.verdict === 'caution') cautionSources.push('volume')
  if (orderflow.verdict === 'caution') cautionSources.push('orderflow')
  // Decision-time order flow missing/stale → caution.
  if (state.orderflowFreshness !== 'fresh') cautionSources.push('orderflow-freshness')

  if (cautionSources.length > 0) {
    return {
      decision: 'caution',
      skipReason: null,
      ...base,
    }
  }

  return {
    decision: 'take',
    skipReason: null,
    ...base,
  }
}

// ─── PATTERN / VOLUME RUN HELPERS ────────────────────────────────────────────

function runPatternRead(state: SignalState): PatternRead {
  if (!state.recent || state.recent.bars.length === 0) return MISSING_PATTERN
  // evaluatePatternGate expects EngineCandle[]; BreakBar has the same fields.
  return evaluatePatternGate(state.direction, state.recent.bars as any)
}

function runVolumeRead(state: SignalState): VolumeRead {
  if (!state.breakBar || !state.recent || state.recent.avgVolume20 <= 0) return MISSING_VOLUME
  return evaluateVolumeGate(state.breakBar.volume, state.recent.avgVolume20)
}

// ─── SKIP CONSTRUCTOR ────────────────────────────────────────────────────────

function skip(
  reason: string,
  base: {
    pattern: PatternRead
    volume: VolumeRead
    orderflow: OrderflowRead
    hardCap: number
    mechanicalContracts: number
    riskPts: number
    rewardPts: number
    rrRatio: number
    riskDollarsPerContract: number
    dailyBudgetRemaining: number
  },
): MechanicalVerdict {
  return { decision: 'skip', skipReason: reason, ...base }
}
