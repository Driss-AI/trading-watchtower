import { describe, it, expect } from 'vitest'
import { evaluateSignal, mechanicalDecide, finalize, skippedReview } from './index'
import type { SignalState, AIReview, OrderflowRead, BreakBar } from './types'

// ─── FIXTURES ────────────────────────────────────────────────────────────────

function makeBar(over: Partial<BreakBar> = {}): BreakBar {
  return {
    open: 100,
    high: 102,
    low: 99.5,
    close: 101.5,
    volume: 1200,
    ticks: 80,
    time: Date.now(),
    ...over,
  }
}

function makeOrderflow(over: Partial<OrderflowRead> = {}): OrderflowRead {
  return {
    available: true,
    verdict: 'confirm',
    cumDelta: 200,
    shortDelta: 150,
    deltaConfirms: true,
    divergence: 'none',
    wallRisk: 'none',
    resistanceVol: 100,
    supportVol: 80,
    reasons: ['delta confirms'],
    ...over,
  }
}

function makeState(over: Partial<SignalState> = {}): SignalState {
  const bar = over.breakBar ?? makeBar()
  return {
    date: '2026-05-30',
    barTime: bar.time,
    market: 'MNQ',
    decisionPoint: 'breakout',
    direction: 'LONG',
    orHigh: 100,
    orLow: 60,
    orSize: 40,
    bufferPoints: 3,
    refPrice: bar.close,
    stopPrice: 60,
    targetPrice: bar.close + 40 * 1.5,
    targetMultiple: 1.5,
    account: {
      dailyPnl: 0,
      tradesCount: 0,
      lossesCount: 0,
      dailyLossLimit: 1000,
      trailingDrawdownRemaining: 2000,
      maxContractsConfig: 5,
    },
    structural: {
      vwap: null, vwapDistance: null,
      priorDayHigh: null, priorDayLow: null,
      overnightHigh: null, overnightLow: null,
    },
    prior: { preSession: null, orAssessment: null },
    breakBar: bar,
    recent: { bars: [bar, bar, bar], avgVolume20: 1000 },
    orderflow: makeOrderflow(),
    candleFreshness: 'fresh',
    orderflowFreshness: 'fresh',
    macroFreshness: 'fresh',
    accountFreshness: 'fresh',
    config: { enablePatternGate: true, enableVolumeGate: true, enableOrderflowVeto: true },
    ...over,
  }
}

function aiApprove(over: Partial<AIReview> = {}): AIReview {
  return {
    status: 'ok', model: 'claude-opus-4-8',
    enter: true, contracts: 3, confidence: 80,
    vetoTake: false, vetoReason: null,
    reasoning: 'clean break with conviction',
    adjustedStop: null, adjustedTarget: null,
    ...over,
  }
}

// ─── PURITY ──────────────────────────────────────────────────────────────────

describe('mechanicalDecide — purity', () => {
  it('produces identical output for identical state (no clock/random)', () => {
    const s = makeState()
    const a = mechanicalDecide(s)
    const b = mechanicalDecide(s)
    expect(a).toEqual(b)
  })
})

// ─── FRESHNESS / FAIL-CLOSED ─────────────────────────────────────────────────

describe('mechanicalDecide — fail-closed on stale decision-time data', () => {
  it('skips when candle data is stale', () => {
    const m = mechanicalDecide(makeState({ candleFreshness: 'stale' }))
    expect(m.decision).toBe('skip')
    expect(m.skipReason).toMatch(/candle.*stale/i)
  })

  it('skips when candle data is missing', () => {
    const m = mechanicalDecide(makeState({ candleFreshness: 'missing' }))
    expect(m.decision).toBe('skip')
    expect(m.skipReason).toMatch(/candle.*missing/i)
  })

  it('skips when account state is stale', () => {
    const m = mechanicalDecide(makeState({ accountFreshness: 'missing' }))
    expect(m.decision).toBe('skip')
    expect(m.skipReason).toMatch(/account.*missing/i)
  })

  it('stale orderflow → caution (not skip) so AI must affirm', () => {
    const m = mechanicalDecide(makeState({
      orderflowFreshness: 'stale',
      orderflow: { ...makeOrderflow(), available: false, verdict: 'caution' },
    }))
    expect(m.decision).toBe('caution')
  })
})

// ─── GATE VETOES ─────────────────────────────────────────────────────────────

describe('mechanicalDecide — gate vetoes', () => {
  it('orderflow veto → skip', () => {
    const m = mechanicalDecide(makeState({
      orderflow: makeOrderflow({ verdict: 'veto', reasons: ['heavy wall'] }),
    }))
    expect(m.decision).toBe('skip')
    expect(m.skipReason).toMatch(/orderflow veto/i)
  })

  it('orderflow veto is ignored when enableOrderflowVeto=false', () => {
    const m = mechanicalDecide(makeState({
      orderflow: makeOrderflow({ verdict: 'veto', reasons: ['heavy wall'] }),
      config: { enablePatternGate: true, enableVolumeGate: true, enableOrderflowVeto: false },
    }))
    expect(m.decision).not.toBe('skip')
  })
})

// ─── SIZING ──────────────────────────────────────────────────────────────────

describe('mechanicalDecide — sizing caps', () => {
  it('hardCap honors after-loss rule (≤2 after a loss)', () => {
    const m = mechanicalDecide(makeState({
      account: {
        dailyPnl: -200, tradesCount: 1, lossesCount: 1,
        dailyLossLimit: 1000, trailingDrawdownRemaining: 2000, maxContractsConfig: 5,
      },
    }))
    expect(m.hardCap).toBeLessThanOrEqual(2)
  })

  it('hardCap honors daily budget — exhausted budget → skip', () => {
    const m = mechanicalDecide(makeState({
      account: {
        dailyPnl: -1000, tradesCount: 1, lossesCount: 1,
        dailyLossLimit: 1000, trailingDrawdownRemaining: 2000, maxContractsConfig: 5,
      },
    }))
    expect(m.decision).toBe('skip')
    expect(m.skipReason).toMatch(/budget/i)
  })

  it('hardCap honors maxContractsConfig', () => {
    const m = mechanicalDecide(makeState({
      account: {
        dailyPnl: 0, tradesCount: 0, lossesCount: 0,
        dailyLossLimit: 1000, trailingDrawdownRemaining: 2000, maxContractsConfig: 2,
      },
    }))
    expect(m.hardCap).toBe(2)
  })
})

// ─── AI AUTHORITY MATRIX ─────────────────────────────────────────────────────

describe('finalize — AI authority matrix', () => {
  it('mechanical SKIP → final skip (AI ignored)', () => {
    const s = makeState({ candleFreshness: 'missing' })
    const m = mechanicalDecide(s)
    const d = finalize(s, m, aiApprove({ enter: true, contracts: 5 }))
    expect(d.finalDecision).toBe('skip')
    expect(d.skipSource).toBe('mechanical')
    expect(d.finalContracts).toBe(0)
  })

  it('mechanical TAKE + AI approve → take', () => {
    const s = makeState()
    const m = mechanicalDecide(s)
    expect(m.decision).toBe('take')
    const d = finalize(s, m, aiApprove({ contracts: 3 }))
    expect(d.finalDecision).toBe('take')
    expect(d.finalContracts).toBe(3)
  })

  it('mechanical TAKE + AI veto → skip with ai-veto source', () => {
    const s = makeState()
    const m = mechanicalDecide(s)
    const d = finalize(s, m, aiApprove({
      enter: false, contracts: 0, vetoTake: true, vetoReason: 'wall ahead',
    }))
    expect(d.finalDecision).toBe('skip')
    expect(d.skipSource).toBe('ai-veto')
    expect(d.skipReason).toBe('wall ahead')
  })

  it('mechanical TAKE + AI declines without veto → skip ai-uncertain', () => {
    const s = makeState()
    const m = mechanicalDecide(s)
    const d = finalize(s, m, aiApprove({ enter: false, contracts: 0, reasoning: 'low conviction' }))
    expect(d.finalDecision).toBe('skip')
    expect(d.skipSource).toBe('ai-uncertain')
  })

  it('mechanical TAKE + AI unavailable → skip ai-unavailable', () => {
    const s = makeState()
    const m = mechanicalDecide(s)
    const review: AIReview = {
      status: 'unavailable', model: 'claude-opus-4-8',
      enter: false, contracts: 0, confidence: 0,
      vetoTake: false, vetoReason: null,
      reasoning: null, adjustedStop: null, adjustedTarget: null,
    }
    const d = finalize(s, m, review)
    expect(d.finalDecision).toBe('skip')
    expect(d.skipSource).toBe('ai-unavailable')
  })

  it('mechanical CAUTION + AI approve → take, capped at 2 contracts', () => {
    const s = makeState({
      orderflowFreshness: 'stale',
      orderflow: makeOrderflow({ available: false, verdict: 'caution' }),
    })
    const m = mechanicalDecide(s)
    expect(m.decision).toBe('caution')
    const d = finalize(s, m, aiApprove({ contracts: 5, confidence: 90 }))
    expect(d.finalDecision).toBe('take')
    expect(d.finalContracts).toBeLessThanOrEqual(2)
  })

  it('mechanical CAUTION + AI declines → skip ai-uncertain', () => {
    const s = makeState({
      orderflowFreshness: 'stale',
      orderflow: makeOrderflow({ available: false, verdict: 'caution' }),
    })
    const m = mechanicalDecide(s)
    const d = finalize(s, m, aiApprove({ enter: false, contracts: 0 }))
    expect(d.finalDecision).toBe('skip')
    expect(d.skipSource).toBe('ai-uncertain')
  })

  it('AI can never exceed hardCap (clamped)', () => {
    const s = makeState({
      account: {
        dailyPnl: 0, tradesCount: 0, lossesCount: 0,
        dailyLossLimit: 1000, trailingDrawdownRemaining: 2000, maxContractsConfig: 3,
      },
    })
    const m = mechanicalDecide(s)
    expect(m.hardCap).toBe(3)
    const d = finalize(s, m, aiApprove({ contracts: 5 }))
    expect(d.finalContracts).toBe(3)
  })

  it('AI cannot escalate SKIP into TAKE (regression for the cardinal rule)', () => {
    const s = makeState({ candleFreshness: 'stale' })
    const m = mechanicalDecide(s)
    const d = finalize(s, m, aiApprove({ enter: true, contracts: 5 }))
    expect(d.finalDecision).toBe('skip')
  })
})

// ─── MANUAL-EXECUTION VALIDITY ───────────────────────────────────────────────

describe('finalize — manual-execution validity', () => {
  it('a plain TAKE is valid for 90s, anchored to barTime (pure, no clock)', () => {
    const s = makeState()
    const m = mechanicalDecide(s)
    const d = finalize(s, m, aiApprove())
    expect(d.finalDecision).toBe('take')
    expect(d.validForSeconds).toBe(90)
    expect(d.signalExpiresAt).toBe(s.barTime + 90_000)
    expect(d.priceAtSignal).toBe(s.refPrice)
  })

  it('LONG max-chase voids the signal 5pts above entry', () => {
    const s = makeState()
    const m = mechanicalDecide(s)
    const d = finalize(s, m, aiApprove())
    expect(d.maxChaseDistance).toBe(5)
    expect(d.cancelIfBeyond).toBe(d.entry + 5)
  })

  it('SHORT max-chase voids the signal 5pts below entry', () => {
    // direction flips the chase sign; assemble computes it regardless of verdict
    const s = makeState({ direction: 'SHORT', candleFreshness: 'stale' })
    const m = mechanicalDecide(s)
    const d = finalize(s, m, aiApprove())
    expect(d.cancelIfBeyond).toBe(d.entry - 5)
  })

  it('a plain TAKE has no entry band (chase rule applies, not a pullback zone)', () => {
    const s = makeState()
    const d = finalize(s, mechanicalDecide(s), aiApprove())
    expect(d.entryBandLow).toBeNull()
    expect(d.entryBandHigh).toBeNull()
  })

  it('a CAUTION take expires faster (45s) and carries a mechanical pullback band', () => {
    const s = makeState({
      orderflowFreshness: 'stale',
      orderflow: makeOrderflow({ available: false, verdict: 'caution' }),
    })
    const m = mechanicalDecide(s)
    expect(m.decision).toBe('caution')
    const d = finalize(s, m, aiApprove({ contracts: 2 }))
    expect(d.finalDecision).toBe('take')
    expect(d.validForSeconds).toBe(45)
    expect(d.signalExpiresAt).toBe(s.barTime + 45_000)
    // band = [broken OR boundary .. break close] for a LONG
    expect(d.entryBandLow).toBe(Math.min(s.orHigh, d.entry))
    expect(d.entryBandHigh).toBe(Math.max(s.orHigh, d.entry))
  })

  it('validity fields are present even on a skip (the card/log always has them)', () => {
    const s = makeState({ candleFreshness: 'missing' })
    const d = finalize(s, mechanicalDecide(s), aiApprove())
    expect(d.finalDecision).toBe('skip')
    expect(d.signalExpiresAt).toBe(s.barTime + 90_000)
    expect(Number.isFinite(d.cancelIfBeyond)).toBe(true)
  })
})

// ─── ADJUSTED STOP/TARGET SANITIZATION ───────────────────────────────────────

describe('finalize — adjusted stop/target sanitization', () => {
  it('rejects an AI stop on the wrong side of entry (LONG)', () => {
    const s = makeState()
    const m = mechanicalDecide(s)
    const d = finalize(s, m, aiApprove({ adjustedStop: s.refPrice + 5 }))
    expect(d.stop).toBe(s.stopPrice)
  })

  it('rejects an AI stop that widens risk > 2x', () => {
    const s = makeState()
    const m = mechanicalDecide(s)
    const origRisk = Math.abs(s.refPrice - s.stopPrice)
    const widened = s.refPrice - origRisk * 3
    const d = finalize(s, m, aiApprove({ adjustedStop: widened }))
    expect(d.stop).toBe(s.stopPrice)
  })

  it('accepts a tighter AI stop on the right side', () => {
    const s = makeState()
    const m = mechanicalDecide(s)
    const tighter = s.refPrice - 5
    const d = finalize(s, m, aiApprove({ adjustedStop: tighter }))
    expect(d.stop).toBe(tighter)
  })
})

// ─── END-TO-END evaluateSignal ───────────────────────────────────────────────

describe('evaluateSignal — orchestration', () => {
  it('mechanical skip → final skip without invoking AI (skipAI=true also works)', async () => {
    const s = makeState({ candleFreshness: 'stale' })
    const d = await evaluateSignal(s, { skipAI: true })
    expect(d.finalDecision).toBe('skip')
    expect(d.ai.status).toBe('skipped')
  })

  it('honors aiReviewOverride for deterministic testing', async () => {
    const s = makeState()
    const d = await evaluateSignal(s, { aiReviewOverride: aiApprove({ contracts: 2 }) })
    expect(d.finalDecision).toBe('take')
    expect(d.finalContracts).toBe(2)
  })
})
