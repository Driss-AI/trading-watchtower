import { describe, it, expect } from 'vitest'
import { buildScoreboard, type ScoreboardRow } from './aggregate'

function row(over: Partial<ScoreboardRow> = {}): ScoreboardRow {
  return {
    finalDecision: 'take',
    skipSource: null,
    mechanicalVerdict: 'take',
    direction: 'LONG',
    outcomeStatus: 'resolved',
    outcomeLabel: 'win',
    outcomeR: 1.5,
    mfeR: 1.8,
    maeR: 0.3,
    manualExecutionStatus: 'NOT_TAKEN',
    entry: 21500,
    actualEntry: null,
    maxChaseDistance: 5,
    executionDelaySeconds: null,
    ...over,
  }
}

const skip = (over: Partial<ScoreboardRow>): ScoreboardRow =>
  row({ finalDecision: 'skip', ...over })

describe('buildScoreboard — cohort classification & stats', () => {
  it('groups takes and computes win rate / avg R / total R', () => {
    const sb = buildScoreboard([
      row({ outcomeLabel: 'win', outcomeR: 1.5 }),
      row({ outcomeLabel: 'win', outcomeR: 2.0 }),
      row({ outcomeLabel: 'loss', outcomeR: -1 }),
    ])
    const taken = sb.cohorts.find((c) => c.key === 'taken')!
    expect(taken.total).toBe(3)
    expect(taken.wins).toBe(2)
    expect(taken.losses).toBe(1)
    expect(taken.winRate).toBe(66.7)        // 2 / (2+1)
    expect(taken.avgR).toBe(0.83)            // (1.5+2-1)/3
    expect(taken.totalR).toBe(2.5)
  })

  it('routes skips into the right cohort by skipSource', () => {
    const sb = buildScoreboard([
      skip({ skipSource: 'ai-veto', outcomeLabel: 'loss', outcomeR: -1 }),
      skip({ skipSource: 'ai-uncertain', outcomeLabel: 'win', outcomeR: 1 }),
      skip({ skipSource: 'mechanical', outcomeLabel: 'loss', outcomeR: -1 }),
    ])
    expect(sb.cohorts.map((c) => c.key)).toEqual(['ai-veto', 'ai-uncertain', 'mechanical'])
  })

  it('excludes pending rows from resolved stats but counts them in total', () => {
    const sb = buildScoreboard([
      row({ outcomeStatus: 'resolved', outcomeLabel: 'win', outcomeR: 1 }),
      row({ outcomeStatus: 'pending', outcomeLabel: null, outcomeR: null }),
    ])
    const taken = sb.cohorts.find((c) => c.key === 'taken')!
    expect(taken.total).toBe(2)
    expect(taken.resolved).toBe(1)
    expect(sb.pendingRows).toBe(1)
  })
})

describe('buildScoreboard — AI value', () => {
  it('veto value is the negative of would-have R (saving a loss is +ve)', () => {
    const sb = buildScoreboard([
      skip({ skipSource: 'ai-veto', outcomeLabel: 'loss', outcomeR: -1 }), // good veto
      skip({ skipSource: 'ai-veto', outcomeLabel: 'win', outcomeR: 2 }),   // bad veto
    ])
    // vetoValue = -(-1 + 2) = -1  → net the AI's vetoes cost 1R here
    expect(sb.ai.vetoValueR).toBe(-1)
    expect(sb.ai.goodVetoes).toBe(1)
    expect(sb.ai.badVetoes).toBe(1)
    expect(sb.ai.vetoAccuracy).toBe(50)
  })

  it('net edge compares actual taken vs take-everything-mechanical', () => {
    const sb = buildScoreboard([
      row({ outcomeR: 2.5, outcomeLabel: 'win' }),                          // taken +2.5
      skip({ skipSource: 'ai-veto', outcomeR: -1, outcomeLabel: 'loss' }),  // AI removed a -1
      skip({ skipSource: 'ai-uncertain', outcomeR: 0.5, outcomeLabel: 'win' }), // AI removed a +0.5
    ])
    expect(sb.ai.takenTotalR).toBe(2.5)
    // counterfactual = taken + removed = 2.5 + (-1 + 0.5) = 2.0
    expect(sb.ai.counterfactualAllMechR).toBe(2)
    // net edge = 2.5 - 2.0 = +0.5  → AI improved on take-everything by 0.5R
    expect(sb.ai.netEdgeR).toBe(0.5)
  })
})

describe('buildScoreboard — execution quality', () => {
  it('measures delay, adverse slippage, and over-chase among taken signals', () => {
    const sb = buildScoreboard([
      row({ manualExecutionStatus: 'TAKEN', entry: 21500, actualEntry: 21503, executionDelaySeconds: 20, maxChaseDistance: 5 }),
      row({ manualExecutionStatus: 'TAKEN', entry: 21500, actualEntry: 21507, executionDelaySeconds: 40, maxChaseDistance: 5 }),
      row({ manualExecutionStatus: 'EXPIRED' }),
      row({ manualExecutionStatus: 'NOT_TAKEN' }),
    ])
    const e = sb.execution
    expect(e.takeSignals).toBe(4)
    expect(e.taken).toBe(2)
    expect(e.missed).toBe(1)               // EXPIRED counts as missed
    expect(e.notLogged).toBe(1)
    expect(e.avgDelaySeconds).toBe(30)     // (20+40)/2
    expect(e.avgAdverseSlippagePts).toBe(5) // (3+7)/2, both adverse for a LONG
    expect(e.overChaseCount).toBe(1)        // 7pt fill > 5pt limit
  })

  it('SHORT adverse slippage is entry − actualEntry (filled lower = worse)', () => {
    const sb = buildScoreboard([
      row({ direction: 'SHORT', manualExecutionStatus: 'TAKEN', entry: 21500, actualEntry: 21496, executionDelaySeconds: 10 }),
    ])
    expect(sb.execution.avgAdverseSlippagePts).toBe(4) // 21500 - 21496
  })
})
