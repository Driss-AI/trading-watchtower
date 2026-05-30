// ─── SIGNAL ENGINE — AI REVIEW ADAPTER ──────────────────────────────────────
// Wraps the existing analyzeBreakout() call into a uniform AIReview shape with
// explicit ok / unavailable / skipped statuses, so finalize() can branch on a
// single discriminator. The AI call itself stays in trading-ai.ts.
//
// Not strictly pure (the AI call is network I/O), but the wrapper has no
// dependence on globals — pass state + mechanical + optional client.

import { analyzeBreakout, TRADE_MODEL } from '../trading-ai'
import type { SignalState, MechanicalVerdict, AIReview } from './types'

const SKIPPED_REVIEW: AIReview = {
  status: 'skipped',
  model: null,
  enter: false,
  contracts: 0,
  confidence: 0,
  vetoTake: false,
  vetoReason: null,
  reasoning: null,
  adjustedStop: null,
  adjustedTarget: null,
}

const UNAVAILABLE_REVIEW: AIReview = {
  status: 'unavailable',
  model: TRADE_MODEL,
  enter: false,
  contracts: 0,
  confidence: 0,
  vetoTake: false,
  vetoReason: null,
  reasoning: 'AI call failed — see logs',
  adjustedStop: null,
  adjustedTarget: null,
}

/** Mechanical SKIP terminates without consulting the AI. */
export function skippedReview(): AIReview {
  return { ...SKIPPED_REVIEW }
}

/** Run the AI breakout review for a TAKE or CAUTION mechanical verdict.
 *  Returns a normalized AIReview; never throws. */
export async function aiReview(
  state: SignalState,
  mechanical: MechanicalVerdict,
): Promise<AIReview> {
  // Hard guard: mechanical SKIP should never reach here. If it does, return
  // the skipped shape so finalize() is robust.
  if (mechanical.decision === 'skip') return skippedReview()

  const preSession = state.prior.preSession ?? {
    shouldTrade: true,
    bias: 'neutral' as const,
    confidence: 50,
    reasoning: 'No pre-session available',
    riskLevel: 'medium' as const,
    adjustments: {},
    keyFactors: [],
  }
  const orAssessment = state.prior.orAssessment ?? {
    quality: 'fair' as const,
    shouldTrade: true,
    preferredDirection: 'either' as const,
    reasoning: 'No OR assessment available',
  }

  try {
    const decision = await analyzeBreakout(
      state.direction,
      state.refPrice,
      state.stopPrice,
      state.targetPrice,
      state.orHigh,
      state.orLow,
      state.orSize,
      preSession,
      orAssessment,
      {
        dailyPnl: state.account.dailyPnl,
        tradesCount: state.account.tradesCount,
        lossesCount: state.account.lossesCount,
        trailingDrawdownRemaining: state.account.trailingDrawdownRemaining,
      },
      mechanical.orderflow as any,
      mechanical.pattern as any,
      mechanical.volume as any,
      state.breakBar as any,
    )

    return {
      status: 'ok',
      model: TRADE_MODEL,
      enter: Boolean(decision.enter),
      contracts: Math.max(0, Math.floor(decision.contracts ?? 0)),
      confidence: Math.max(0, Math.min(100, decision.confidence ?? 0)),
      vetoTake: Boolean(decision.vetoTake),
      vetoReason: decision.vetoReason ? String(decision.vetoReason).trim() || null : null,
      reasoning: decision.reasoning ?? null,
      adjustedStop: typeof decision.adjustedStop === 'number' ? decision.adjustedStop : null,
      adjustedTarget: typeof decision.adjustedTarget === 'number' ? decision.adjustedTarget : null,
    }
  } catch (err) {
    console.error('[SignalEngine] aiReview failed — returning unavailable:', err)
    return { ...UNAVAILABLE_REVIEW }
  }
}
