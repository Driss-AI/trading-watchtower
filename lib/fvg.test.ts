import { describe, it, expect } from 'vitest'
import { detectFVGs, nearestFVG } from './fvg'
import type { Candle } from './patterns'

// o,h,l,c — time/ticks irrelevant to gap geometry.
function mk(o: number, h: number, l: number, c: number, t = 0): Candle {
  return { open: o, high: h, low: l, close: c, time: t, ticks: 1 }
}

describe('detectFVGs', () => {
  it('detects a bullish FVG (gap up, candle[i-2].high < candle[i].low)', () => {
    // a.high=101, displacement up, c.low=104 → gap band [101, 104]
    const candles = [mk(100, 101, 99, 100.5), mk(101, 105, 101, 104.5), mk(104, 107, 104, 106)]
    const fvgs = detectFVGs(candles, { includeFilled: true })
    expect(fvgs).toHaveLength(1)
    expect(fvgs[0].dir).toBe('bullish')
    expect(fvgs[0].bottom).toBe(101)
    expect(fvgs[0].top).toBe(104)
    expect(fvgs[0].mid).toBe(102.5)
    expect(fvgs[0].filled).toBe(false)
  })

  it('detects a bearish FVG (gap down, candle[i-2].low > candle[i].high)', () => {
    // a.low=99, displacement down, c.high=96 → gap band [96, 99]
    const candles = [mk(100, 101, 99, 99.5), mk(99, 99, 95, 95.5), mk(96, 96, 93, 94)]
    const fvgs = detectFVGs(candles, { includeFilled: true })
    expect(fvgs).toHaveLength(1)
    expect(fvgs[0].dir).toBe('bearish')
    expect(fvgs[0].bottom).toBe(96)
    expect(fvgs[0].top).toBe(99)
  })

  it('marks a gap filled once price trades through the far edge', () => {
    // bullish gap [101,104]; a later candle dips to 100 (< bottom 101) → filled
    const candles = [
      mk(100, 101, 99, 100.5),
      mk(101, 105, 101, 104.5),
      mk(104, 107, 104, 106),
      mk(105, 105, 100, 102), // low 100 fills the gap
    ]
    const active = detectFVGs(candles) // default excludes filled
    expect(active).toHaveLength(0)
    const all = detectFVGs(candles, { includeFilled: true })
    expect(all[0].filled).toBe(true)
  })

  it('returns nothing when candles overlap (no imbalance)', () => {
    const candles = [mk(100, 102, 99, 101), mk(101, 103, 100, 102), mk(102, 104, 101, 103)]
    expect(detectFVGs(candles, { includeFilled: true })).toHaveLength(0)
  })

  it('respects maxAgeBars and minSize filters', () => {
    const candles = [mk(100, 101, 99, 100.5), mk(101, 105, 101, 104.5), mk(104, 107, 104, 106)]
    expect(detectFVGs(candles, { includeFilled: true, maxAgeBars: 0 })[0].ageBars).toBe(0)
    expect(detectFVGs(candles, { includeFilled: true, minSize: 5 })).toHaveLength(0) // gap is 3pts
  })
})

describe('nearestFVG', () => {
  it('finds the closest unfilled gap to a price', () => {
    const candles = [mk(100, 101, 99, 100.5), mk(101, 105, 101, 104.5), mk(104, 107, 104, 106)]
    const fvgs = detectFVGs(candles, { includeFilled: true })
    const near = nearestFVG(fvgs, 106, 'bullish')
    expect(near?.top).toBe(104)
  })

  it('returns null when no active gap matches', () => {
    expect(nearestFVG([], 100)).toBeNull()
  })
})
