import { describe, it, expect } from 'vitest'
import { renderTradeCard } from './render'
import type { SignalDecision, PatternRead, VolumeRead, OrderflowRead, AIReview } from '../signal-engine/types'

function makeDecision(over: Partial<SignalDecision> = {}): SignalDecision {
  const pattern: PatternRead = {
    verdict: 'confirm', patternName: 'Bullish Marubozu',
    patternSignal: 'bullish', patternStrength: 80,
    orbContext: 'breakout candle past OR High',
    reasons: ['confirms LONG'],
  }
  const volume: VolumeRead = {
    verdict: 'confirm', breakVolume: 1500, avgVolume: 1000, ratio: 1.5,
    reasons: ['heavy bar'],
  }
  const orderflow: OrderflowRead = {
    available: true, verdict: 'confirm',
    cumDelta: 300, shortDelta: 200, deltaConfirms: true,
    divergence: 'none', wallRisk: 'none',
    resistanceVol: 100, supportVol: 80,
    reasons: ['delta confirms'],
  }
  const ai: AIReview = {
    status: 'ok', model: 'claude-opus-4-8',
    enter: true, contracts: 3, confidence: 85,
    vetoTake: false, vetoReason: null,
    reasoning: 'clean break with conviction',
    adjustedStop: null, adjustedTarget: null,
  }
  return {
    date: '2026-05-30', barTime: Date.UTC(2026, 4, 30, 14, 47),
    market: 'MNQ', direction: 'LONG',
    finalDecision: 'take', finalContracts: 3,
    skipReason: null, skipSource: null,
    entry: 21500, stop: 21460, target: 21560,
    riskPts: 40, rewardPts: 60, rrRatio: 1.5,
    priceAtSignal: 21500,
    signalExpiresAt: Date.UTC(2026, 4, 30, 14, 47) + 90_000,
    validForSeconds: 90, maxChaseDistance: 5, cancelIfBeyond: 21505,
    entryBandLow: null, entryBandHigh: null,
    mechanicalVerdict: 'take', mechanicalContracts: 3, hardCap: 5,
    pattern, volume, orderflow, ai,
    candleFreshness: 'fresh', orderflowFreshness: 'fresh',
    macroFreshness: 'fresh', accountFreshness: 'fresh',
    rationale: 'clean break with conviction',
    orHigh: 21490, orLow: 21450,
    ...over,
  }
}

const CTX = { riskDollarsPerContract: 80, dailyBudgetRemaining: 1000 }

describe('renderTradeCard — TAKE', () => {
  it('renders a complete action card with entry / stop / target / contracts', () => {
    const card = renderTradeCard(makeDecision(), CTX)
    expect(card).toContain('CALL: LONG')
    expect(card).toContain('Entry:')
    expect(card).toContain('Stop:')
    expect(card).toContain('Target:')
    expect(card).toContain('Recommended:')
    expect(card).toContain('3 contracts')
    expect(card).toContain('Manual action:')
    expect(card).toContain('Confidence:')
  })

  it('shows CAUTION downsize reason when mechanical=caution', () => {
    const card = renderTradeCard(makeDecision({
      mechanicalVerdict: 'caution', finalContracts: 2,
    }), CTX)
    expect(card).toContain('CAUTION downsize')
  })

  it('surfaces signal validity: valid-until window, max chase, and cancel rule', () => {
    const card = renderTradeCard(makeDecision(), CTX)
    expect(card).toContain('Valid until:')
    expect(card).toContain('Max chase:')
    expect(card).toContain('5.0 pts')
    expect(card).toContain('21505.00') // cancelIfBeyond
    expect(card).toContain('Cancel if:')
  })

  it('shows the CAUTION entry band (pullback zone, no chase) instead of max chase', () => {
    const card = renderTradeCard(makeDecision({
      mechanicalVerdict: 'caution', finalContracts: 2,
      validForSeconds: 45, entryBandLow: 21490, entryBandHigh: 21500,
    }), CTX)
    expect(card).toContain('Entry band:')
    expect(card).toContain('21490.00–21500.00')
    expect(card).toContain('do NOT chase')
    expect(card).not.toContain('Max chase:')
  })
})

describe('renderTradeCard — SKIP variants', () => {
  it('mechanical skip → NO TRADE card with stay-out action', () => {
    const card = renderTradeCard(makeDecision({
      finalDecision: 'skip', finalContracts: 0,
      skipSource: 'mechanical', skipReason: 'pattern veto — Doji at OR High',
    }), CTX)
    expect(card).toContain('NO TRADE')
    expect(card).toContain('pattern veto')
    expect(card).toContain('Stay out')
    expect(card).not.toContain('Recommended:')
  })

  it('ai-veto → AI VETO card', () => {
    const card = renderTradeCard(makeDecision({
      finalDecision: 'skip', finalContracts: 0,
      skipSource: 'ai-veto', skipReason: 'resting wall ahead',
    }), CTX)
    expect(card).toContain('AI VETO')
    expect(card).toContain('Trust the veto')
  })

  it('ai-unavailable → warning card', () => {
    const card = renderTradeCard(makeDecision({
      finalDecision: 'skip', finalContracts: 0,
      skipSource: 'ai-unavailable',
      skipReason: 'AI unavailable — skip per safety policy',
    }), CTX)
    expect(card).toContain('AI DOWN')
    expect(card).toContain('never trade without the brain')
  })

  it('ai-uncertain → AI SKIPPED card', () => {
    const card = renderTradeCard(makeDecision({
      finalDecision: 'skip', finalContracts: 0,
      skipSource: 'ai-uncertain', skipReason: 'low conviction',
    }), CTX)
    expect(card).toContain('AI SKIPPED')
  })
})
