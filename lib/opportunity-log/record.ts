// ─── OPPORTUNITY LOG — RECORD ───────────────────────────────────────────────
// Maps a SignalDecision + the SignalState it was made against into a
// SignalOpportunity row. One write per OR-buffer crossing evaluated by the
// engine, taken or skipped. The row is updated later (linkPaperTrade,
// resolveOutcome) but the initial write captures the full decision context.

import { prisma } from '../prisma'
import type { SignalState, SignalDecision } from '../signal-engine/types'

export interface WriteSignalOpportunityInput {
  state: SignalState
  decision: SignalDecision
  source?: 'paper' | 'backtest' | 'live-signal'
}

export async function writeSignalOpportunity(
  input: WriteSignalOpportunityInput,
): Promise<string> {
  const { state, decision } = input
  const source = input.source ?? 'paper'

  // Would-have entry/stop/target for skipped rows so the monitor can resolve
  // outcomes. For takens, the linked PaperTrade carries the realized values.
  const wouldEntry = decision.finalDecision === 'skip' ? decision.entry : null
  const wouldStop = decision.finalDecision === 'skip' ? decision.stop : null
  const wouldTarget = decision.finalDecision === 'skip' ? decision.target : null

  const row = await prisma.signalOpportunity.create({
    data: {
      date: state.date,
      barTime: new Date(state.barTime),
      market: state.market,
      direction: state.direction,

      orHigh: state.orHigh,
      orLow: state.orLow,
      orSize: state.orSize,
      refPrice: state.refPrice,
      entry: decision.entry,
      stop: decision.stop,
      target: decision.target,
      riskPts: decision.riskPts,
      rewardPts: decision.rewardPts,
      rrRatio: decision.rrRatio,

      vwap: state.structural.vwap,
      vwapDistance: state.structural.vwapDistance,
      priorDayHigh: state.structural.priorDayHigh,
      priorDayLow: state.structural.priorDayLow,
      overnightHigh: state.structural.overnightHigh,
      overnightLow: state.structural.overnightLow,

      patternName: decision.pattern.patternName,
      patternVerdict: decision.pattern.verdict,
      patternSignal: decision.pattern.patternSignal,
      patternStrength: decision.pattern.patternStrength,
      orbContext: decision.pattern.orbContext,

      volumeRatio: decision.volume.ratio,
      volumeVerdict: decision.volume.verdict,
      breakVolume: decision.volume.breakVolume,
      avgVolume: decision.volume.avgVolume,

      orderflowVerdict: decision.orderflow.verdict,
      orderflowAvailable: decision.orderflow.available,
      cumDeltaAtBreak: decision.orderflow.cumDelta,
      shortDeltaAtBreak: decision.orderflow.shortDelta,
      deltaDivergence: decision.orderflow.divergence,
      wallRisk: decision.orderflow.wallRisk,

      gateVerdictsJson: {
        pattern: decision.pattern,
        volume: decision.volume,
        orderflow: decision.orderflow,
      } as any,

      candleFreshness: decision.candleFreshness,
      orderflowFreshness: decision.orderflowFreshness,
      macroFreshness: decision.macroFreshness,
      accountFreshness: decision.accountFreshness,

      mechanicalVerdict: decision.mechanicalVerdict,
      mechanicalContracts: decision.mechanicalContracts,
      hardCap: decision.hardCap,

      aiStatus: decision.ai.status,
      aiModel: decision.ai.model,
      aiEnter: decision.ai.status === 'ok' ? decision.ai.enter : null,
      aiConfidence: decision.ai.status === 'ok' ? decision.ai.confidence : null,
      aiContracts: decision.ai.status === 'ok' ? decision.ai.contracts : null,
      aiVetoTake: decision.ai.status === 'ok' ? decision.ai.vetoTake : null,
      aiVetoReason: decision.ai.vetoReason,
      aiReasoning: decision.ai.reasoning,

      finalDecision: decision.finalDecision,
      finalContracts: decision.finalContracts,
      skipReason: decision.skipReason,
      skipSource: decision.skipSource,
      rationale: decision.rationale,

      wouldEntry,
      wouldStop,
      wouldTarget,

      source,
    },
  })

  return row.id
}

/** Attach a paper trade ID to a previously-written opportunity row. */
export async function linkPaperTrade(opportunityId: string, paperTradeId: string): Promise<void> {
  await prisma.signalOpportunity.update({
    where: { id: opportunityId },
    data: { paperTradeId },
  })
}
