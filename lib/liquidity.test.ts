import { describe, it, expect } from 'vitest'
import { detectSweep, buildLiquidityRead } from './liquidity'
import type { Candle } from './patterns'
import type { DailyLevels } from './levels'

function mk(o: number, h: number, l: number, c: number, t = 0): Candle {
  return { open: o, high: h, low: l, close: c, time: t, ticks: 1 }
}

const levels: DailyLevels = { pdh: 120, pdl: 80, pdc: 100, source: 'topstepx-daily', asOf: '2026-06-05' }

describe('detectSweep', () => {
  it('flags a sweep above with rejection (poked above level, closed back below)', () => {
    const candles = [mk(98, 99, 97, 98), mk(99, 102, 99, 101.5), mk(101, 101.5, 98, 99)]
    const s = detectSweep(candles, 100, 'above')
    expect(s.swept).toBe(true)
    expect(s.rejected).toBe(true) // last close 99 < 100
  })

  it('flags a sweep below with rejection', () => {
    const candles = [mk(102, 103, 101, 102), mk(101, 101, 97, 98), mk(99, 101, 99, 101)]
    const s = detectSweep(candles, 100, 'below')
    expect(s.swept).toBe(true)
    expect(s.rejected).toBe(true) // last close 101 > 100
  })

  it('no sweep when price never pokes through', () => {
    const candles = [mk(95, 98, 94, 97), mk(96, 99, 95, 98)]
    expect(detectSweep(candles, 100, 'above').swept).toBe(false)
  })

  it('swept but not rejected when price stays beyond the level', () => {
    const candles = [mk(99, 101, 99, 100.5), mk(101, 103, 101, 102.5)]
    const s = detectSweep(candles, 100, 'above')
    expect(s.swept).toBe(true)
    expect(s.rejected).toBe(false)
  })
})

describe('buildLiquidityRead', () => {
  it('classifies a LONG break that swept PDH and rejected as sweep-reversal', () => {
    // price pokes above PDH 120 then closes back below → sweep + rejection
    const candles = [mk(116, 119, 115, 118), mk(118, 123, 118, 122), mk(122, 123, 117, 118)]
    const read = buildLiquidityRead({
      candles, lastPrice: 118, orHigh: 117, orLow: 110, levels, breakDirection: 'LONG',
    })
    expect(read.classification).toBe('sweep-reversal')
    expect(read.reversalHint).toMatch(/SHORT/)
    expect(read.text).toMatch(/LIQUIDITY MAP/)
  })

  it('flags no-room when the break runs straight into nearby opposing liquidity', () => {
    // LONG at 118, PDH 120 only 2 pts above, no sweep yet
    const candles = [mk(115, 117, 114, 116), mk(116, 118, 115, 117.5), mk(117, 118, 116, 118)]
    const read = buildLiquidityRead({
      candles, lastPrice: 118, orHigh: 117, orLow: 110, levels, breakDirection: 'LONG',
    })
    expect(read.classification).toBe('no-room')
  })

  it('classifies continuation when there is room and no sweep', () => {
    // LONG at 105, plenty of room up to PDH 120
    const candles = [mk(101, 103, 100, 102), mk(102, 105, 101, 104), mk(104, 106, 103, 105)]
    const read = buildLiquidityRead({
      candles, lastPrice: 105, orHigh: 104, orLow: 98, levels, breakDirection: 'LONG',
    })
    expect(read.classification).toBe('continuation')
  })

  it('returns neutral (no classification) when no break direction is given', () => {
    const candles = [mk(101, 103, 100, 102), mk(102, 105, 101, 104), mk(104, 106, 103, 105)]
    const read = buildLiquidityRead({ candles, lastPrice: 105, orHigh: 104, orLow: 98, levels })
    expect(read.classification).toBe('neutral')
    expect(read.text).toMatch(/PDH 120/)
  })

  it('degrades gracefully with no levels', () => {
    const candles = [mk(101, 103, 100, 102)]
    const read = buildLiquidityRead({ candles, lastPrice: 102, levels: null })
    expect(read.text).toMatch(/unavailable/)
  })
})
