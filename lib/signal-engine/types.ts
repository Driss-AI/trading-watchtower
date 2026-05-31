// ─── SIGNAL ENGINE — TYPES ──────────────────────────────────────────────────
// Contracts for the pure decision engine. The invariant: evaluateSignal(state)
// is a pure function. All I/O lives upstream in lib/signal-context/collect.ts,
// which builds a SignalState and sets *Freshness flags. The engine reads the
// state and produces a SignalDecision. No DB. No clock. No network.

import type { PreSessionDecision, ORAssessment } from '../trading-ai'

// ─── INPUT: SIGNAL STATE ─────────────────────────────────────────────────────

export type Freshness = 'fresh' | 'stale' | 'missing'

/** Snapshot of the just-closed bar at the OR boundary. */
export interface BreakBar {
  open: number
  high: number
  low: number
  close: number
  volume: number
  ticks: number
  time: number // ms epoch, close-of-bar timestamp
}

/** Recent bars used by multi-bar pattern detection (newest at end). */
export interface RecentBars {
  bars: BreakBar[]
  avgVolume20: number
}

/** Account / risk-budget snapshot at decision time. */
export interface AccountState {
  dailyPnl: number
  tradesCount: number
  lossesCount: number
  dailyLossLimit: number
  trailingDrawdownRemaining: number
  maxContractsConfig: number // engine config cap (1-5)
}

/** Order-flow read carried into the engine (already a verdict from the gate). */
export interface OrderflowRead {
  available: boolean
  verdict: 'confirm' | 'caution' | 'veto'
  cumDelta: number
  shortDelta: number
  deltaConfirms: boolean
  divergence: 'none' | 'mild' | 'strong'
  wallRisk: 'none' | 'moderate' | 'high'
  resistanceVol: number
  supportVol: number
  reasons: string[]
}

/** Structural context — levels the brain reads but doesn't compute. */
export interface StructuralContext {
  vwap: number | null
  vwapDistance: number | null
  priorDayHigh: number | null
  priorDayLow: number | null
  overnightHigh: number | null
  overnightLow: number | null
}

/** Pre-decision context already produced by the AI earlier in the session. */
export interface PriorAIContext {
  preSession: PreSessionDecision | null
  orAssessment: ORAssessment | null
}

/** Identifies the decision point in the session lifecycle. */
export type DecisionPoint = 'breakout' // Sprint 1 = breakout-on-close only

/** Everything the pure engine needs. Carries freshness flags so the engine
 *  can enforce fail-closed without touching I/O. */
export interface SignalState {
  // Identity
  date: string // YYYY-MM-DD (NY date)
  barTime: number // ms epoch of break-bar close
  market: string // MNQ / NQ
  decisionPoint: DecisionPoint

  // Direction + OR
  direction: 'LONG' | 'SHORT'
  orHigh: number
  orLow: number
  orSize: number
  bufferPoints: number

  // Trade math (mechanical defaults — engine may refine targets)
  refPrice: number // close of break bar, used as entry
  stopPrice: number
  targetPrice: number
  targetMultiple: number

  // Context
  account: AccountState
  structural: StructuralContext
  prior: PriorAIContext

  // Decision-time data
  breakBar: BreakBar | null
  recent: RecentBars | null
  orderflow: OrderflowRead | null

  // Freshness — set by collect(), read by the engine
  candleFreshness: Freshness
  orderflowFreshness: Freshness
  macroFreshness: Freshness
  accountFreshness: Freshness

  // Toggles (from engine config — engine respects them)
  config: {
    enablePatternGate: boolean
    enableVolumeGate: boolean
    enableOrderflowVeto: boolean
  }
}

// ─── MECHANICAL VERDICT ──────────────────────────────────────────────────────
// What the pre-AI gates concluded. The full audit trail per gate.

export type GateVerdict = 'confirm' | 'caution' | 'neutral' | 'veto'

export interface PatternRead {
  verdict: GateVerdict
  patternName: string | null
  patternSignal: 'bullish' | 'bearish' | 'neutral' | 'caution' | null
  patternStrength: number | null
  orbContext: string | null
  reasons: string[]
}

export interface VolumeRead {
  verdict: GateVerdict
  breakVolume: number
  avgVolume: number
  ratio: number
  reasons: string[]
}

/** The pre-AI combined verdict. Caller uses this to decide whether to consult
 *  the AI at all (TAKE / CAUTION go to AI; SKIP terminates immediately). */
export type MechanicalDecision = 'take' | 'caution' | 'skip'

export interface MechanicalVerdict {
  decision: MechanicalDecision
  skipReason: string | null // populated when decision === 'skip'
  hardCap: number // max contracts allowed by risk math (1-5)
  mechanicalContracts: number // sizing the engine would use without AI
  pattern: PatternRead
  volume: VolumeRead
  orderflow: OrderflowRead
  // For auditing / opportunity log
  riskPts: number
  rewardPts: number
  rrRatio: number
  riskDollarsPerContract: number
  dailyBudgetRemaining: number
}

// ─── AI REVIEW ───────────────────────────────────────────────────────────────

export type AIReviewStatus =
  | 'ok' // AI returned a structured verdict
  | 'unavailable' // AI call failed / threw / returned no tool_use
  | 'skipped' // AI was not consulted (mechanical SKIP)

export interface AIReview {
  status: AIReviewStatus
  model: string | null
  enter: boolean
  contracts: number
  confidence: number
  vetoTake: boolean
  vetoReason: string | null
  reasoning: string | null
  adjustedStop: number | null
  adjustedTarget: number | null
}

// ─── FINAL SIGNAL DECISION ───────────────────────────────────────────────────
// The output of the engine. One row's worth of audit, ready to write to DB.

export type FinalDecision = 'take' | 'skip'

/** Lifecycle of the user's real manual action against a signal. Stored on the
 *  SignalOpportunity row and set via recordManualExecution(). */
export type ManualExecutionStatus =
  | 'NOT_TAKEN' // signal fired, user has not acted (or window still open)
  | 'TAKEN'     // user placed the order
  | 'SKIPPED'   // user deliberately passed
  | 'MISSED'    // user intended to take it but didn't in time
  | 'CANCELLED' // user pulled the order after placing
  | 'EXPIRED'   // validity window elapsed with no action

export type SkipSource =
  | 'mechanical' // gates or risk math killed it
  | 'ai-veto' // AI explicitly vetoed
  | 'ai-unavailable' // AI failed and safety policy is skip
  | 'ai-uncertain' // mechanical CAUTION + AI didn't approve

export interface SignalDecision {
  // Identity (carries from state)
  date: string
  barTime: number
  market: string
  direction: 'LONG' | 'SHORT'

  // OR boundaries (for the trade card's invalidation text)
  orHigh: number
  orLow: number

  // Final
  finalDecision: FinalDecision
  finalContracts: number // 0 when skip
  skipReason: string | null
  skipSource: SkipSource | null

  // Trade math (entry / stop / target the engine will use if taking)
  entry: number
  stop: number
  target: number
  riskPts: number
  rewardPts: number
  rrRatio: number

  // Manual-execution validity (computed pure from barTime + geometry in finalize)
  priceAtSignal: number
  signalExpiresAt: number // ms epoch
  validForSeconds: number
  maxChaseDistance: number // points the user may chase past entry
  cancelIfBeyond: number // price beyond which the signal is void
  entryBandLow: number | null // CAUTION pullback band (null for a plain TAKE)
  entryBandHigh: number | null

  // Mechanical breakdown
  mechanicalVerdict: MechanicalDecision
  mechanicalContracts: number
  hardCap: number
  pattern: PatternRead
  volume: VolumeRead
  orderflow: OrderflowRead

  // AI breakdown
  ai: AIReview

  // Freshness snapshot
  candleFreshness: Freshness
  orderflowFreshness: Freshness
  macroFreshness: Freshness
  accountFreshness: Freshness

  // For trade-card prose
  rationale: string
}
