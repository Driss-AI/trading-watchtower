// ─── SIGNAL ENGINE — ENTRY POINT ────────────────────────────────────────────
// evaluateSignal orchestrates the three steps:
//   1. mechanicalDecide(state)         — pure
//   2. aiReview(state, mechanical)     — async I/O, normalized
//   3. finalize(state, mechanical, ai) — pure
//
// The function is the shared brain for paper trading, backtesting, and
// manual signal generation. All non-purity is concentrated in step 2.

import { mechanicalDecide } from './mechanical'
import { aiReview, skippedReview } from './ai-review'
import { finalize } from './finalize'
import type { SignalState, SignalDecision, MechanicalVerdict, AIReview } from './types'

export interface EvaluateSignalOptions {
  /** When true, skip the AI call entirely (backtest-mechanical mode, tests). */
  skipAI?: boolean
  /** Inject a pre-canned AI review (replay / tests). */
  aiReviewOverride?: AIReview
}

export async function evaluateSignal(
  state: SignalState,
  options: EvaluateSignalOptions = {},
): Promise<SignalDecision> {
  const mechanical: MechanicalVerdict = mechanicalDecide(state)

  // Mechanical SKIP terminates without consulting AI.
  if (mechanical.decision === 'skip') {
    return finalize(state, mechanical, skippedReview())
  }

  let review: AIReview
  if (options.aiReviewOverride) {
    review = options.aiReviewOverride
  } else if (options.skipAI) {
    review = skippedReview()
  } else {
    review = await aiReview(state, mechanical)
  }

  return finalize(state, mechanical, review)
}

export type { SignalState, SignalDecision, MechanicalVerdict, AIReview } from './types'
export { mechanicalDecide } from './mechanical'
export { finalize } from './finalize'
export { aiReview, skippedReview } from './ai-review'
