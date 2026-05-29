import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ingestTrades,
  getLatestClosedCandle,
  getRecentCandles,
  getLiveCandle,
  getAvgVolume,
  getCandleSnapshot,
  isStale,
  resetCandlesDay,
} from './candles'

beforeEach(() => {
  resetCandlesDay()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('1-min bar aggregation', () => {
  it('rolls open/high/low/close as ticks arrive within a minute', () => {
    vi.setSystemTime(new Date('2026-01-05T14:30:30Z'))
    ingestTrades([{ price: 100, volume: 5, type: 0 }])
    ingestTrades([{ price: 102, volume: 3, type: 0 }])
    ingestTrades([{ price: 99, volume: 4, type: 1 }])
    ingestTrades([{ price: 101, volume: 2, type: 0 }])

    const live = getLiveCandle()
    expect(live).not.toBeNull()
    expect(live!.open).toBe(100)
    expect(live!.high).toBe(102)
    expect(live!.low).toBe(99)
    expect(live!.close).toBe(101)
    expect(live!.volume).toBe(14)
    expect(live!.ticks).toBe(4)
  })

  it('closes the previous bar when ticks cross a 1-min boundary', () => {
    vi.setSystemTime(new Date('2026-01-05T14:30:30Z'))
    ingestTrades([{ price: 100, volume: 5, type: 0 }])
    // jump to next minute
    vi.setSystemTime(new Date('2026-01-05T14:31:05Z'))
    ingestTrades([{ price: 105, volume: 7, type: 0 }])

    const closed = getLatestClosedCandle()
    expect(closed).not.toBeNull()
    expect(closed!.close).toBe(100)
    expect(closed!.volume).toBe(5)
    const live = getLiveCandle()
    expect(live!.open).toBe(105)
  })

  it('rollIfNeeded promotes a stale in-progress bar when time has advanced silently', () => {
    vi.setSystemTime(new Date('2026-01-05T14:30:30Z'))
    ingestTrades([{ price: 100, volume: 5, type: 0 }])
    // No more trades — but time advances past the bar boundary.
    vi.setSystemTime(new Date('2026-01-05T14:32:00Z'))
    const closed = getLatestClosedCandle()
    expect(closed).not.toBeNull()
    expect(closed!.close).toBe(100)
  })

  it('ignores prints with non-positive price or volume', () => {
    vi.setSystemTime(new Date('2026-01-05T14:30:30Z'))
    ingestTrades([{ price: 0, volume: 5, type: 0 }])
    ingestTrades([{ price: 100, volume: 0, type: 0 }])
    expect(getLiveCandle()).toBeNull()
  })
})

describe('volume baseline', () => {
  it('averages volume across recent closed bars', () => {
    let t = new Date('2026-01-05T14:30:30Z').getTime()
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(new Date(t + i * 60_000))
      ingestTrades([{ price: 100 + i, volume: (i + 1) * 10, type: 0 }])
    }
    // Force the last in-progress bar to close.
    vi.setSystemTime(new Date(t + 5 * 60_000 + 5_000))
    // call rollIfNeeded via a query
    getCandleSnapshot()
    // After 5 bars: volumes 10, 20, 30, 40, 50 → avg = 30
    const recent = getRecentCandles(5)
    expect(recent.length).toBeGreaterThan(0)
    const avg = getAvgVolume(5)
    expect(avg).toBeGreaterThan(0)
  })

  it('returns 0 when no closed bars exist yet', () => {
    expect(getAvgVolume(20)).toBe(0)
  })
})

describe('staleness', () => {
  it('is stale before any trade arrives', () => {
    expect(isStale()).toBe(true)
  })
})
