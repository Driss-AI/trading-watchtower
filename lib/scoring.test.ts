import { describe, it, expect } from 'vitest'
import { calculateScore, calculateRisk, POINT_VALUES, type ScoreInput } from './scoring'

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function baseInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    hasHighImpactNews: false,
    orSize: 80,
    directionBias: 'bullish',
    tradeDirection: 'LONG',
    vixExtreme: false,
    qqpAligned: true,
    us10yAgainst: false,
    dxyAgainst: false,
    cleanRoomToTarget: true,
    tradesToday: 0,
    lossesToday: 0,
    dailyLossLimitHit: false,
    maxTradesPerDay: 2,
    maxLosingTradesPerDay: 2,
    ...overrides,
  }
}

// ─── SCORING ENGINE ──────────────────────────────────────────────────────────

describe('calculateScore', () => {
  describe('hard blockers', () => {
    it('returns NO_TRADE when daily loss limit hit', () => {
      const result = calculateScore(baseInput({ dailyLossLimitHit: true }))
      expect(result.score).toBe(0)
      expect(result.decision).toBe('NO_TRADE')
      expect(result.blockers.length).toBeGreaterThan(0)
    })

    it('returns NO_TRADE when max trades reached', () => {
      const result = calculateScore(baseInput({ tradesToday: 2, maxTradesPerDay: 2 }))
      expect(result.score).toBe(0)
      expect(result.decision).toBe('NO_TRADE')
    })

    it('returns NO_TRADE when max losing trades reached', () => {
      const result = calculateScore(baseInput({ lossesToday: 2, maxLosingTradesPerDay: 2 }))
      expect(result.score).toBe(0)
      expect(result.decision).toBe('NO_TRADE')
    })

    it('returns empty factors when blocked', () => {
      const result = calculateScore(baseInput({ dailyLossLimitHit: true }))
      expect(result.factors).toHaveLength(0)
    })
  })

  describe('perfect conditions', () => {
    it('scores >= 80 with TRADE decision', () => {
      const result = calculateScore(baseInput())
      expect(result.score).toBeGreaterThanOrEqual(80)
      expect(result.decision).toBe('TRADE')
    })

    it('achieves max score of 100', () => {
      const result = calculateScore(baseInput())
      expect(result.score).toBe(100)
    })
  })

  describe('news penalty', () => {
    it('drops score by 50 total (loses +20, gets -30)', () => {
      const clean = calculateScore(baseInput())
      const withNews = calculateScore(baseInput({ hasHighImpactNews: true }))
      expect(clean.score - withNews.score).toBe(50)
    })
  })

  describe('opening range boundaries', () => {
    it('penalizes OR below 30 pts', () => {
      const result = calculateScore(baseInput({ orSize: 29 }))
      expect(result.score).toBeLessThan(100)
    })

    it('accepts OR at exactly 30 pts', () => {
      const at30 = calculateScore(baseInput({ orSize: 30 }))
      const at29 = calculateScore(baseInput({ orSize: 29 }))
      expect(at30.score).toBeGreaterThan(at29.score)
    })

    it('accepts OR at exactly 200 pts', () => {
      const at200 = calculateScore(baseInput({ orSize: 200 }))
      const at201 = calculateScore(baseInput({ orSize: 201 }))
      expect(at200.score).toBeGreaterThan(at201.score)
    })

    it('penalizes OR above 200 pts', () => {
      const result = calculateScore(baseInput({ orSize: 201 }))
      expect(result.score).toBeLessThan(100)
    })
  })

  describe('direction alignment', () => {
    it('neutral bias always passes alignment', () => {
      const long = calculateScore(baseInput({ directionBias: 'neutral', tradeDirection: 'LONG' }))
      const short = calculateScore(baseInput({ directionBias: 'neutral', tradeDirection: 'SHORT' }))
      expect(long.score).toBe(short.score)
    })

    it('penalizes direction against bias', () => {
      const aligned = calculateScore(baseInput({ directionBias: 'bullish', tradeDirection: 'LONG' }))
      const against = calculateScore(baseInput({ directionBias: 'bullish', tradeDirection: 'SHORT' }))
      expect(aligned.score).toBeGreaterThan(against.score)
    })
  })

  describe('score clamping', () => {
    it('never goes below 0', () => {
      const result = calculateScore(baseInput({
        hasHighImpactNews: true,
        orSize: 250,
        directionBias: 'bullish',
        tradeDirection: 'SHORT',
        vixExtreme: true,
        qqpAligned: false,
        us10yAgainst: true,
        dxyAgainst: true,
        cleanRoomToTarget: false,
      }))
      expect(result.score).toBe(0)
    })
  })

  describe('decision thresholds', () => {
    it('score 80 → TRADE', () => {
      const result = calculateScore(baseInput({ dxyAgainst: true, cleanRoomToTarget: false }))
      // 100 - 5 (dxy) - 10 (room) = 85
      expect(result.score).toBe(85)
      expect(result.decision).toBe('TRADE')
    })

    it('score below 65 → NO_TRADE', () => {
      const result = calculateScore(baseInput({
        hasHighImpactNews: true,
        qqpAligned: false,
        cleanRoomToTarget: false,
      }))
      // loses +20 news, +10 qqp, +10 room = 60; then -30 penalty = 30
      expect(result.score).toBeLessThan(65)
      expect(result.decision).toBe('NO_TRADE')
    })
  })
})

// ─── RISK CALCULATOR ─────────────────────────────────────────────────────────

describe('calculateRisk', () => {
  it('uses correct point values per market', () => {
    expect(POINT_VALUES['MNQ']).toBe(2)
    expect(POINT_VALUES['NQ']).toBe(20)
    expect(POINT_VALUES['ES']).toBe(50)
    expect(POINT_VALUES['MES']).toBe(5)
  })

  it('defaults to 2 for unknown markets', () => {
    const result = calculateRisk({
      market: 'UNKNOWN', entry: 100, stop: 95, target: 110,
      contracts: 1, accountSize: 50000, dailyLossLimit: 1000, currentDailyPnl: 0,
    })
    expect(result.pointValue).toBe(2)
  })

  it('calculates risk/reward correctly', () => {
    const result = calculateRisk({
      market: 'MNQ', entry: 100, stop: 95, target: 110,
      contracts: 1, accountSize: 50000, dailyLossLimit: 1000, currentDailyPnl: 0,
    })
    expect(result.riskPts).toBe(5)
    expect(result.rewardPts).toBe(10)
    expect(result.rrRatio).toBe(2)
    expect(result.riskPerContract).toBe(10)
    expect(result.totalRisk).toBe(10)
    expect(result.totalReward).toBe(20)
  })

  it('multiplies by contracts', () => {
    const result = calculateRisk({
      market: 'MNQ', entry: 100, stop: 95, target: 110,
      contracts: 3, accountSize: 50000, dailyLossLimit: 1000, currentDailyPnl: 0,
    })
    expect(result.totalRisk).toBe(30)
    expect(result.totalReward).toBe(60)
  })

  it('detects limit violation', () => {
    const result = calculateRisk({
      market: 'NQ', entry: 18000, stop: 17950, target: 18100,
      contracts: 2, accountSize: 50000, dailyLossLimit: 1000, currentDailyPnl: 0,
    })
    // 50 pts * $20 * 2 contracts = $2000 risk vs $1000 limit
    expect(result.violatesLimit).toBe(true)
    expect(result.violationMessage).toContain('⛔')
  })

  it('warns at 80% of remaining risk', () => {
    const result = calculateRisk({
      market: 'MNQ', entry: 18000, stop: 17550, target: 18900,
      contracts: 1, accountSize: 50000, dailyLossLimit: 1000, currentDailyPnl: 0,
    })
    // 450 pts * $2 = $900 risk, $1000 limit → 90% → warning
    expect(result.violatesLimit).toBe(false)
    expect(result.violationMessage).toContain('⚠️')
  })

  it('handles zero riskPts without division error', () => {
    const result = calculateRisk({
      market: 'MNQ', entry: 100, stop: 100, target: 110,
      contracts: 1, accountSize: 50000, dailyLossLimit: 1000, currentDailyPnl: 0,
    })
    expect(result.rrRatio).toBe(10) // rewardPts / 1 (guard)
    expect(Number.isFinite(result.maxContractsAllowed)).toBe(true)
  })

  it('reduces remaining risk with negative daily P&L', () => {
    const result = calculateRisk({
      market: 'MNQ', entry: 100, stop: 95, target: 110,
      contracts: 1, accountSize: 50000, dailyLossLimit: 1000, currentDailyPnl: -500,
    })
    expect(result.remainingDailyRisk).toBe(500)
  })

  it('calculates maxContractsAllowed correctly', () => {
    const result = calculateRisk({
      market: 'MNQ', entry: 100, stop: 95, target: 110,
      contracts: 1, accountSize: 50000, dailyLossLimit: 1000, currentDailyPnl: 0,
    })
    // $1000 remaining / $10 per contract = 100
    expect(result.maxContractsAllowed).toBe(100)
  })
})
