import { describe, it, expect } from 'vitest'
import { computeMetrics, computeSplitMetrics } from './metrics'
import type { BacktestTrade, SessionReplay } from './types'

function trade(over: Partial<BacktestTrade> & { resultR: number }): BacktestTrade {
  const { resultR, resultDollars, outcome, ...rest } = over
  return {
    date: '2025-06-16', barTime: 0, direction: 'LONG',
    entry: 100, stop: 90, target: 130, exitPrice: 130, exitTime: 0,
    barsHeld: 3, contracts: 1, resultPts: 0,
    exitReason: 'target',
    ...rest,
    resultR,
    resultDollars: resultDollars ?? resultR * 100,
    outcome: outcome ?? (resultR > 0 ? 'win' : resultR < 0 ? 'loss' : 'be'),
  }
}

describe('computeMetrics', () => {
  it('empty → zeroed metrics', () => {
    const m = computeMetrics([])
    expect(m.totalTrades).toBe(0)
    expect(m.expectancyR).toBe(0)
    expect(m.profitFactor).toBe(0)
  })

  it('win/loss tallies, expectancy, profit factor', () => {
    // 3 wins of +1.5R, 2 losses of −1R → totalR = 4.5 − 2 = 2.5; expectancy 0.5
    const m = computeMetrics([
      trade({ resultR: 1.5 }), trade({ resultR: -1 }), trade({ resultR: 1.5 }),
      trade({ resultR: -1 }), trade({ resultR: 1.5 }),
    ])
    expect(m.totalTrades).toBe(5)
    expect(m.wins).toBe(3)
    expect(m.losses).toBe(2)
    expect(m.winRate).toBe(0.6)
    expect(m.totalR).toBe(2.5)
    expect(m.expectancyR).toBe(0.5)
    expect(m.profitFactor).toBe(2.25) // 4.5 / 2
    expect(m.avgWinR).toBe(1.5)
    expect(m.avgLossR).toBe(-1)
  })

  it('max losing streak counts consecutive losses only', () => {
    const m = computeMetrics([
      trade({ resultR: -1 }), trade({ resultR: -1 }), trade({ resultR: -1 }),
      trade({ resultR: 2 }), trade({ resultR: -1 }), trade({ resultR: -1 }),
    ])
    expect(m.maxLosingStreak).toBe(3)
  })

  it('max drawdown R tracks the worst peak-to-trough on the equity curve', () => {
    // curve: +2 (peak 2), −1 (1), −1 (0), −1 (−1, dd from peak2 = 3), +5 (4)
    const m = computeMetrics([
      trade({ resultR: 2 }), trade({ resultR: -1 }), trade({ resultR: -1 }),
      trade({ resultR: -1 }), trade({ resultR: 5 }),
    ])
    expect(m.maxDrawdownR).toBe(3)
  })

  it('all-wins profit factor is Infinity', () => {
    const m = computeMetrics([trade({ resultR: 1 }), trade({ resultR: 2 })])
    expect(m.profitFactor).toBe(Infinity)
  })

  it('signalCount overrides totalSignals (takes + skips)', () => {
    const m = computeMetrics([trade({ resultR: 1 })], 10)
    expect(m.totalSignals).toBe(10)
    expect(m.totalTrades).toBe(1)
  })
})

describe('computeSplitMetrics — IS/OOS', () => {
  function session(date: string, resultR: number | null): SessionReplay {
    return {
      date, orHigh: 110, orLow: 100,
      signal: resultR === null ? null : {
        date, barTime: new Date(date).getTime(), direction: 'LONG',
        decision: {} as any,
        trade: trade({ date, resultR }),
      },
      reason: null,
    }
  }

  it('holds out the last third of distinct dates for OOS', () => {
    const sessions = [
      session('2025-06-01', 1),
      session('2025-06-02', 1),
      session('2025-06-03', -1),
      session('2025-06-04', 1),
      session('2025-06-05', -1),
      session('2025-06-06', 1), // 6 dates → split at idx floor(6*0.67)=4 → '2025-06-05'
    ]
    const split = computeSplitMetrics(sessions, 0.33)
    expect(split.splitDate).toBe('2025-06-05')
    expect(split.inSample.totalTrades).toBe(4) // 06-01..06-04
    expect(split.outOfSample.totalTrades).toBe(2) // 06-05, 06-06
    expect(split.all.totalTrades).toBe(6)
  })

  it('single date → no OOS split', () => {
    const split = computeSplitMetrics([session('2025-06-01', 1)])
    expect(split.splitDate).toBeNull()
    expect(split.outOfSample.totalTrades).toBe(0)
  })
})
