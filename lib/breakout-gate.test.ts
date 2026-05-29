import { describe, it, expect } from 'vitest'
import {
  evaluatePatternGate,
  evaluateVolumeGate,
  combineVerdicts,
} from './breakout-gate'
import type { EngineCandle } from './candles'

// Helper to build a candle. Time is irrelevant for gate logic — only shape matters.
function mkCandle(o: number, h: number, l: number, c: number, vol = 100): EngineCandle {
  return { open: o, high: h, low: l, close: c, time: 0, ticks: 1, volume: vol }
}

describe('pattern gate — fail-open', () => {
  it('returns neutral when no candles are provided', () => {
    const g = evaluatePatternGate('LONG', [])
    expect(g.verdict).toBe('neutral')
    expect(g.patternName).toBeNull()
  })

  it('returns neutral when no recognizable pattern is on the break bar', () => {
    // A nondescript mid-body candle that detectPattern won't match.
    const c = mkCandle(100, 100.4, 99.8, 100.2)
    const g = evaluatePatternGate('LONG', [c])
    expect(g.verdict).toBe('neutral')
  })
})

describe('pattern gate — trap patterns at OR boundary', () => {
  it('vetoes LONG on a Shooting Star at OR High', () => {
    // Body 2pt bearish, long upper wick (8pt), tiny lower wick — Shooting Star.
    const c = mkCandle(102, 110, 99.8, 100)
    const g = evaluatePatternGate('LONG', [c])
    expect(g.patternName).toBe('Shooting Star')
    expect(g.verdict).toBe('veto')
  })

  it('vetoes SHORT on a Hammer at OR Low', () => {
    // Body 1pt bullish, long lower wick (8pt), tiny upper wick — Hammer.
    const c = mkCandle(100, 101.2, 92, 101)
    const g = evaluatePatternGate('SHORT', [c])
    expect(g.patternName).toBe('Hammer')
    expect(g.verdict).toBe('veto')
  })

  it('vetoes LONG on a Doji at the level', () => {
    const c = mkCandle(100, 100.5, 99.5, 100.0)
    const g = evaluatePatternGate('LONG', [c])
    expect(g.patternName).toBe('Doji')
    expect(g.verdict).toBe('veto')
  })
})

describe('pattern gate — confirmation patterns', () => {
  it('confirms LONG on a Bullish Marubozu', () => {
    // No wicks, bullish full body.
    const c = mkCandle(100, 105, 100, 105)
    const g = evaluatePatternGate('LONG', [c])
    expect(g.patternName).toBe('Bullish Marubozu')
    expect(g.verdict).toBe('confirm')
  })

  it('confirms SHORT on a Bearish Marubozu', () => {
    const c = mkCandle(105, 105, 100, 100)
    const g = evaluatePatternGate('SHORT', [c])
    expect(g.patternName).toBe('Bearish Marubozu')
    expect(g.verdict).toBe('confirm')
  })
})

describe('volume gate', () => {
  it('vetoes thin break bars below 0.8× average', () => {
    const g = evaluateVolumeGate(50, 100)
    expect(g.verdict).toBe('veto')
    expect(g.ratio).toBe(0.5)
  })

  it('confirms heavy break bars >= 1.4× average', () => {
    const g = evaluateVolumeGate(200, 100)
    expect(g.verdict).toBe('confirm')
    expect(g.ratio).toBe(2)
  })

  it('cautions break bars between 0.8 and 1.0×', () => {
    const g = evaluateVolumeGate(90, 100)
    expect(g.verdict).toBe('caution')
  })

  it('is neutral around normal volume', () => {
    const g = evaluateVolumeGate(110, 100)
    expect(g.verdict).toBe('neutral')
  })

  it('fails open when no baseline exists', () => {
    expect(evaluateVolumeGate(50, 0).verdict).toBe('neutral')
    expect(evaluateVolumeGate(0, 100).verdict).toBe('neutral')
  })
})

describe('combineVerdicts', () => {
  it('any veto wins', () => {
    expect(combineVerdicts(['confirm', 'veto', 'confirm'])).toBe('veto')
  })
  it('caution otherwise', () => {
    expect(combineVerdicts(['confirm', 'caution', 'neutral'])).toBe('caution')
  })
  it('confirm only when all confirm', () => {
    expect(combineVerdicts(['confirm', 'confirm'])).toBe('confirm')
    expect(combineVerdicts(['confirm', 'neutral'])).toBe('neutral')
  })
})
