// ─── TRADING WATCHTOWER — SCORING ENGINE ─────────────────────────────────────
// Calculates trade quality score 0–100 with decision logic

// Single source of truth for "did we breach the daily loss limit today?"
// dailyPnl is signed: negative = loss. Only a loss can breach. A positive P&L
// of +$1,000 is NOT a breach of a $1,000 daily-loss limit.
export function isDailyLossLimitHit(dailyPnl: number, dailyLossLimit: number): boolean {
  return dailyPnl <= -dailyLossLimit
}

export interface ScoreInput {
  // Market conditions (manual input)
  hasHighImpactNews: boolean
  orSize: number
  directionBias: 'bullish' | 'bearish' | 'neutral'
  tradeDirection: 'LONG' | 'SHORT'
  vixExtreme: boolean       // VIX > 30
  qqpAligned: boolean       // QQQ premarket aligns with trade direction
  us10yAgainst: boolean     // 10Y yield moving against trade
  dxyAgainst: boolean       // DXY moving against trade
  cleanRoomToTarget: boolean

  // Session state (from database)
  tradesToday: number
  lossesToday: number
  dailyLossLimitHit: boolean

  // Account settings
  maxTradesPerDay: number
  maxLosingTradesPerDay: number
}

export interface ScoreFactor {
  label: string
  points: number
  met: boolean
}

export interface ScoreResult {
  score: number
  decision: 'TRADE' | 'CAUTION' | 'NO_TRADE'
  decisionLabel: string
  decisionColor: string
  factors: ScoreFactor[]
  blockers: string[]
}

// OR size thresholds for NQ/MNQ
const OR_MIN = 30   // too narrow below this
const OR_MAX = 200  // too wide above this
const OR_IDEAL_MIN = 50
const OR_IDEAL_MAX = 150

export function calculateScore(input: ScoreInput): ScoreResult {
  const factors: ScoreFactor[] = []
  const blockers: string[] = []
  let score = 0

  // ─── HARD BLOCKERS (–100 each) ──────────────────────────────────────────
  if (input.dailyLossLimitHit) {
    blockers.push('Daily loss limit has been hit — stop trading today')
  }
  if (input.tradesToday >= input.maxTradesPerDay) {
    blockers.push(`Maximum ${input.maxTradesPerDay} trades reached for today`)
  }
  if (input.lossesToday >= input.maxLosingTradesPerDay) {
    blockers.push(`Maximum ${input.maxLosingTradesPerDay} losing trades reached — session over`)
  }

  // If any hard blocker is hit, return score 0 immediately
  if (blockers.length > 0) {
    return {
      score: 0,
      decision: 'NO_TRADE',
      decisionLabel: '🔴 NO TRADE — Session Blocked',
      decisionColor: 'red',
      factors: [],
      blockers,
    }
  }

  // ─── POSITIVE FACTORS ───────────────────────────────────────────────────

  // No high-impact news: +20
  const noNews = !input.hasHighImpactNews
  factors.push({ label: 'No high-impact news', points: 20, met: noNews })
  if (noNews) score += 20

  // OR size acceptable (not too tight, not too wide): +15
  const orOk = input.orSize >= OR_MIN && input.orSize <= OR_MAX
  factors.push({
    label: `Opening range size acceptable (${OR_MIN}–${OR_MAX} pts)`,
    points: 15,
    met: orOk,
  })
  if (orOk) score += 15

  // Direction aligned with bias: +20
  const dirAligned =
    (input.directionBias === 'bullish' && input.tradeDirection === 'LONG') ||
    (input.directionBias === 'bearish' && input.tradeDirection === 'SHORT') ||
    input.directionBias === 'neutral'
  factors.push({
    label: `Direction aligned with daily bias (${input.directionBias})`,
    points: 20,
    met: dirAligned,
  })
  if (dirAligned) score += 20

  // VIX not extreme: +10
  const vixOk = !input.vixExtreme
  factors.push({ label: 'VIX not extreme (< 30)', points: 10, met: vixOk })
  if (vixOk) score += 10

  // QQQ premarket aligned: +10
  factors.push({ label: 'QQQ premarket aligned with trade', points: 10, met: input.qqpAligned })
  if (input.qqpAligned) score += 10

  // US10Y not against trade: +10
  const us10yOk = !input.us10yAgainst
  factors.push({ label: 'US 10Y not strongly against trade', points: 10, met: us10yOk })
  if (us10yOk) score += 10

  // DXY not against trade: +5
  const dxyOk = !input.dxyAgainst
  factors.push({ label: 'DXY not strongly against trade', points: 5, met: dxyOk })
  if (dxyOk) score += 5

  // Clean room to target: +10
  factors.push({ label: 'Clean room to target (no major S/R blocking)', points: 10, met: input.cleanRoomToTarget })
  if (input.cleanRoomToTarget) score += 10

  // ─── NEGATIVE ADJUSTMENTS ───────────────────────────────────────────────

  // High-impact news: –30 (on top of not getting the +20)
  if (input.hasHighImpactNews) {
    factors.push({ label: 'HIGH-IMPACT NEWS TODAY — penalty', points: -30, met: false })
    score -= 30
  }

  // OR too wide: –20
  if (input.orSize > OR_MAX) {
    factors.push({ label: `Opening range too wide (> ${OR_MAX} pts)`, points: -20, met: false })
    score -= 20
  }

  // OR too narrow: –10
  if (input.orSize < OR_MIN) {
    factors.push({ label: `Opening range too narrow (< ${OR_MIN} pts)`, points: -10, met: false })
    score -= 10
  }

  // VIX extreme: –20 (on top of not getting +10)
  if (input.vixExtreme) {
    factors.push({ label: 'VIX extreme (> 30) — penalty', points: -20, met: false })
    score -= 20
  }

  // Direction against bias: –20 (only if bias is not neutral)
  if (!dirAligned && input.directionBias !== 'neutral') {
    factors.push({ label: 'Direction AGAINST daily bias — penalty', points: -20, met: false })
    score -= 20
  }

  // Clamp to 0–100
  score = Math.max(0, Math.min(100, score))

  // ─── DECISION ───────────────────────────────────────────────────────────
  let decision: ScoreResult['decision']
  let decisionLabel: string
  let decisionColor: string

  if (score >= 80) {
    decision = 'TRADE'
    decisionLabel = '🟢 TRADE ALLOWED'
    decisionColor = 'green'
  } else if (score >= 65) {
    decision = 'CAUTION'
    decisionLabel = '🟡 CAUTION — Reduce size'
    decisionColor = 'yellow'
  } else {
    decision = 'NO_TRADE'
    decisionLabel = '🔴 NO TRADE'
    decisionColor = 'red'
  }

  return { score, decision, decisionLabel, decisionColor, factors, blockers }
}

// ─── RISK CALCULATOR ────────────────────────────────────────────────────────

export const POINT_VALUES: Record<string, number> = {
  MNQ: 2,
  NQ: 20,
  MES: 5,
  ES: 50,
}

export interface RiskCalcInput {
  market: string
  entry: number
  stop: number
  target: number
  contracts: number
  accountSize: number
  dailyLossLimit: number
  currentDailyPnl: number
}

export interface RiskCalcResult {
  pointValue: number
  riskPts: number
  rewardPts: number
  rrRatio: number
  riskPerContract: number
  totalRisk: number
  totalReward: number
  maxContractsAllowed: number
  remainingDailyRisk: number
  violatesLimit: boolean
  violationMessage: string
}

export function calculateRisk(input: RiskCalcInput): RiskCalcResult {
  const pointValue = POINT_VALUES[input.market] ?? 2
  const riskPts = Math.abs(input.entry - input.stop)
  const rewardPts = Math.abs(input.target - input.entry)
  const rrRatio = rewardPts / (riskPts || 1)
  const riskPerContract = riskPts * pointValue
  const totalRisk = riskPerContract * input.contracts
  const totalReward = rewardPts * pointValue * input.contracts
  const remainingDailyRisk = input.dailyLossLimit + input.currentDailyPnl
  const maxContractsAllowed = Math.floor(remainingDailyRisk / (riskPerContract || 1))
  const violatesLimit = totalRisk > remainingDailyRisk

  let violationMessage = ''
  if (violatesLimit) {
    violationMessage = `⛔ This trade risks $${totalRisk.toFixed(0)} but only $${remainingDailyRisk.toFixed(0)} of daily limit remains`
  } else if (totalRisk > remainingDailyRisk * 0.8) {
    violationMessage = `⚠️ Warning: This trade uses ${((totalRisk / remainingDailyRisk) * 100).toFixed(0)}% of remaining daily risk`
  }

  return {
    pointValue,
    riskPts,
    rewardPts,
    rrRatio,
    riskPerContract,
    totalRisk,
    totalReward,
    maxContractsAllowed: Math.max(0, maxContractsAllowed),
    remainingDailyRisk,
    violatesLimit,
    violationMessage,
  }
}
