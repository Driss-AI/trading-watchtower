// ─── SIGNAL ENGINE — FINALIZE ───────────────────────────────────────────────
// Pure function. Applies the AI authority matrix on top of a MechanicalVerdict
// and AIReview, producing the final SignalDecision the caller will log,
// render, and (if take) execute.
//
// AUTHORITY MATRIX (enforced here):
//
//   Mechanical | AI status   | AI signal           | Final     | Source
//   -----------|-------------|---------------------|-----------|--------------
//   skip       | (skipped)   | —                   | skip      | mechanical
//   take       | ok          | enter, !vetoTake    | take      | —
//   take       | ok          | vetoTake            | skip      | ai-veto
//   take       | ok          | !enter, !vetoTake   | skip      | ai-uncertain
//   take       | unavailable | —                   | skip      | ai-unavailable
//   caution    | ok          | enter, !vetoTake    | take (≤2) | —
//   caution    | ok          | vetoTake            | skip      | ai-veto
//   caution    | ok          | !enter, !vetoTake   | skip      | ai-uncertain
//   caution    | unavailable | —                   | skip      | ai-unavailable
//
// CAUTION DOWNSIZE: any TAKE from a CAUTION verdict is capped at 2 contracts,
// regardless of AI confidence. Reduce risk, never inflate.
//
// AI CANNOT escalate SKIP → TAKE. AI CANNOT exceed hardCap. Enforced here.

import type {
  SignalState,
  MechanicalVerdict,
  AIReview,
  SignalDecision,
  SkipSource,
} from './types'

const CAUTION_CAP = 2 // contracts cap when mechanical verdict is CAUTION

// ── Manual-execution validity. A signal the user places by hand needs a shelf
// life. Anchored to barTime so finalize stays pure (no clock reads). Tunable. ──
const TAKE_VALID_SECONDS = 90    // a plain TAKE is actionable for this long after bar close
const CAUTION_VALID_SECONDS = 45 // a CAUTION pullback window expires faster
const MAX_CHASE_POINTS = 5       // points past entry the user may chase before the signal is void

export function finalize(
  state: SignalState,
  mechanical: MechanicalVerdict,
  ai: AIReview,
): SignalDecision {
  // ── 1. Mechanical SKIP → terminal skip ──
  if (mechanical.decision === 'skip') {
    return assemble({
      state,
      mechanical,
      ai,
      finalDecision: 'skip',
      finalContracts: 0,
      skipReason: mechanical.skipReason ?? 'mechanical skip',
      skipSource: 'mechanical',
      entry: state.refPrice,
      stop: state.stopPrice,
      target: state.targetPrice,
      rationale: mechanical.skipReason ?? 'mechanical gates skipped this signal',
    })
  }

  // ── 2. AI unavailable → fail-closed skip ──
  if (ai.status === 'unavailable') {
    return assemble({
      state,
      mechanical,
      ai,
      finalDecision: 'skip',
      finalContracts: 0,
      skipReason: 'AI unavailable — skip per safety policy',
      skipSource: 'ai-unavailable',
      entry: state.refPrice,
      stop: state.stopPrice,
      target: state.targetPrice,
      rationale: 'Mechanical TAKE/CAUTION but AI review failed; safety policy is skip.',
    })
  }

  // ── 3. AI explicit veto → skip ──
  if (ai.status === 'ok' && ai.vetoTake) {
    return assemble({
      state,
      mechanical,
      ai,
      finalDecision: 'skip',
      finalContracts: 0,
      skipReason: ai.vetoReason ?? 'AI veto without reason',
      skipSource: 'ai-veto',
      entry: state.refPrice,
      stop: state.stopPrice,
      target: state.targetPrice,
      rationale: ai.vetoReason ?? ai.reasoning ?? 'AI vetoed the trade',
    })
  }

  // ── 4. AI says no (no formal veto) → skip ──
  if (ai.status === 'ok' && !ai.enter) {
    const reason = ai.reasoning ?? 'AI declined the trade'
    const source: SkipSource = mechanical.decision === 'caution' ? 'ai-uncertain' : 'ai-uncertain'
    return assemble({
      state,
      mechanical,
      ai,
      finalDecision: 'skip',
      finalContracts: 0,
      skipReason: reason,
      skipSource: source,
      entry: state.refPrice,
      stop: state.stopPrice,
      target: state.targetPrice,
      rationale: reason,
    })
  }

  // ── 5. AI approves — finalize as TAKE ──
  // Cap: hardCap ∧ ai.contracts ∧ (CAUTION_CAP if mechanical=caution)
  const ceiling = mechanical.decision === 'caution'
    ? Math.min(mechanical.hardCap, CAUTION_CAP)
    : mechanical.hardCap

  const aiAsked = ai.contracts > 0 ? ai.contracts : mechanical.mechanicalContracts
  const finalContracts = Math.max(1, Math.min(aiAsked, ceiling))

  // Adjusted stop/target: accept AI's only if they make geometric sense.
  const stop = sanitizeStop(state, ai.adjustedStop)
  const target = sanitizeTarget(state, ai.adjustedTarget)

  return assemble({
    state,
    mechanical,
    ai,
    finalDecision: 'take',
    finalContracts,
    skipReason: null,
    skipSource: null,
    entry: state.refPrice,
    stop,
    target,
    rationale: ai.reasoning ?? 'AI approved entry',
  })
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function sanitizeStop(state: SignalState, adjusted: number | null): number {
  if (adjusted == null || !Number.isFinite(adjusted)) return state.stopPrice
  // Stop must be on the loss side of entry.
  if (state.direction === 'LONG' && adjusted >= state.refPrice) return state.stopPrice
  if (state.direction === 'SHORT' && adjusted <= state.refPrice) return state.stopPrice
  // Don't accept a stop that widens risk beyond the original by more than 2x
  // (sanity guard against typos / hallucinated numbers).
  const origRisk = Math.abs(state.refPrice - state.stopPrice)
  const newRisk = Math.abs(state.refPrice - adjusted)
  if (origRisk > 0 && newRisk > origRisk * 2) return state.stopPrice
  return adjusted
}

function sanitizeTarget(state: SignalState, adjusted: number | null): number {
  if (adjusted == null || !Number.isFinite(adjusted)) return state.targetPrice
  if (state.direction === 'LONG' && adjusted <= state.refPrice) return state.targetPrice
  if (state.direction === 'SHORT' && adjusted >= state.refPrice) return state.targetPrice
  return adjusted
}

interface AssembleInput {
  state: SignalState
  mechanical: MechanicalVerdict
  ai: AIReview
  finalDecision: 'take' | 'skip'
  finalContracts: number
  skipReason: string | null
  skipSource: SkipSource | null
  entry: number
  stop: number
  target: number
  rationale: string
}

function assemble(x: AssembleInput): SignalDecision {
  const riskPts = Math.abs(x.entry - x.stop)
  const rewardPts = Math.abs(x.target - x.entry)
  const rrRatio = riskPts > 0 ? rewardPts / riskPts : 0

  // ── Manual-execution validity ──
  const validForSeconds = x.mechanical.decision === 'caution'
    ? CAUTION_VALID_SECONDS
    : TAKE_VALID_SECONDS
  const signalExpiresAt = x.state.barTime + validForSeconds * 1000
  const maxChaseDistance = MAX_CHASE_POINTS
  const cancelIfBeyond = x.state.direction === 'LONG'
    ? x.entry + maxChaseDistance
    : x.entry - maxChaseDistance

  // CAUTION takes are valid ONLY on a pullback into [broken OR boundary .. break
  // close] — a mechanical band, not "use your judgement". null for a plain TAKE.
  let entryBandLow: number | null = null
  let entryBandHigh: number | null = null
  if (x.finalDecision === 'take' && x.mechanical.decision === 'caution') {
    const orBoundary = x.state.direction === 'LONG' ? x.state.orHigh : x.state.orLow
    entryBandLow = Math.min(orBoundary, x.entry)
    entryBandHigh = Math.max(orBoundary, x.entry)
  }

  return {
    date: x.state.date,
    barTime: x.state.barTime,
    market: x.state.market,
    direction: x.state.direction,

    orHigh: x.state.orHigh,
    orLow: x.state.orLow,

    finalDecision: x.finalDecision,
    finalContracts: x.finalContracts,
    skipReason: x.skipReason,
    skipSource: x.skipSource,

    entry: x.entry,
    stop: x.stop,
    target: x.target,
    riskPts,
    rewardPts,
    rrRatio,

    priceAtSignal: x.state.refPrice,
    signalExpiresAt,
    validForSeconds,
    maxChaseDistance,
    cancelIfBeyond,
    entryBandLow,
    entryBandHigh,

    mechanicalVerdict: x.mechanical.decision,
    mechanicalContracts: x.mechanical.mechanicalContracts,
    hardCap: x.mechanical.hardCap,
    pattern: x.mechanical.pattern,
    volume: x.mechanical.volume,
    orderflow: x.mechanical.orderflow,

    ai: x.ai,

    candleFreshness: x.state.candleFreshness,
    orderflowFreshness: x.state.orderflowFreshness,
    macroFreshness: x.state.macroFreshness,
    accountFreshness: x.state.accountFreshness,

    rationale: x.rationale,
  }
}
