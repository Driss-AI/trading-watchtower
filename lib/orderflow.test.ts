import { describe, it, expect, beforeEach } from 'vitest'
import {
  ingestTrades,
  ingestDepth,
  assessBreakout,
  getCumDelta,
  getShortDelta,
  resetOrderflowDay,
} from './orderflow'

beforeEach(() => {
  resetOrderflowDay()
})

describe('delta aggregation', () => {
  it('signs buys positive and sells negative', () => {
    ingestTrades([{ price: 100, volume: 5, type: 0 }]) // buy aggressor
    ingestTrades([{ price: 100, volume: 3, type: 1 }]) // sell aggressor
    expect(getCumDelta()).toBe(2)
    expect(getShortDelta()).toBe(2)
  })

  it('accepts a single (non-array) print payload', () => {
    ingestTrades({ price: 100, volume: 4, type: 0 })
    expect(getCumDelta()).toBe(4)
  })

  it('ignores prints with zero volume or missing aggressor type', () => {
    ingestTrades([{ price: 100, volume: 0, type: 0 }])
    ingestTrades([{ price: 100, volume: 5 }]) // no type
    expect(getCumDelta()).toBe(0)
  })
})

describe('assessBreakout — fail-closed on stale/missing data', () => {
  it('returns caution (not confirm) when no trade data has arrived', () => {
    const a = assessBreakout('LONG', 100)
    expect(a.available).toBe(false)
    expect(a.verdict).toBe('caution')
    expect(a.deltaConfirms).toBe(false)
    expect(a.reasons.join(' ')).toMatch(/fail-closed/)
  })

  it('returns caution when refPrice is invalid', () => {
    ingestTrades([{ price: 100, volume: 5, type: 0 }])
    const a = assessBreakout('LONG', 0)
    expect(a.available).toBe(false)
    expect(a.verdict).toBe('caution')
  })
})

describe('assessBreakout — delta divergence', () => {
  it('vetoes a LONG when strong net selling diverges', () => {
    ingestTrades([{ price: 100, volume: 300, type: 1 }]) // -300 net
    const a = assessBreakout('LONG', 100)
    expect(a.available).toBe(true)
    expect(a.divergence).toBe('strong')
    expect(a.verdict).toBe('veto')
  })

  it('does NOT veto a SHORT on that same net selling (flow aligns)', () => {
    ingestTrades([{ price: 100, volume: 300, type: 1 }]) // -300 net = selling = confirms a short
    const a = assessBreakout('SHORT', 100)
    expect(a.divergence).toBe('none')
    expect(a.verdict).toBe('confirm')
  })

  it('confirms a LONG when aligned buying backs the break', () => {
    ingestTrades([{ price: 100, volume: 100, type: 0 }]) // +100 net
    const a = assessBreakout('LONG', 100)
    expect(a.deltaConfirms).toBe(true)
    expect(a.verdict).toBe('confirm')
  })
})

describe('assessBreakout — DOM absorbing wall', () => {
  it('vetoes a LONG when a heavy ask wall sits just above', () => {
    ingestTrades([{ price: 100, volume: 1, type: 0 }]) // keep data fresh; tiny +1 delta
    ingestDepth([
      { price: 101, volume: 500 },
      { price: 102, volume: 600 },
    ]) // resting volume above the breakout level
    const a = assessBreakout('LONG', 100)
    expect(a.resistanceVol).toBe(1100)
    expect(a.wallRisk).toBe('high')
    expect(a.verdict).toBe('veto')
  })
})
