// ─── TRADING AI BRAIN ─────────────────────────────────────────────────────────
// Uses Claude to make intelligent trading decisions based on all available
// market data. Called at 3 strategic decision points — not on every tick.
//
// 1. Pre-session:    "Should we trade today?"   (macro, news, VIX)
// 2. OR assessment:  "Is this OR worth trading?" (OR quality + context)
// 3. Breakout gate:  "Take this breakout?"      (final confirmation)

import Anthropic from '@anthropic-ai/sdk'
import type { MarketBriefing, MacroSentiment } from './market-data'
import type { SessionImpact } from './calendar-intel'

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
    _client = new Anthropic({ apiKey })
  }
  return _client
}

const FAST_MODEL = 'claude-haiku-4-5-20251001'
const DEEP_MODEL = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = `You are an elite NQ/MNQ day trader running a 50K TopStepX combine account.

COMBINE RULES (non-negotiable):
- Daily loss limit: $1,000 (hit this = auto-fail day)
- Trailing drawdown: $2,000 (breach = account blown, combine over)
- Profit target: $3,000 (reach = combine passed)
- Max 2 trades per day
- Max 2 losing trades per day
- MNQ point value: $2 per point per contract

STRATEGY: Opening Range Breakout (ORB) on MNQ
- Opening range: 9:30-10:00 AM ET
- Trade window: 10:00-11:30 AM ET
- Entry: price breaks OR high (long) or OR low (short) with buffer
- Stop: opposite OR boundary
- Target: 1.5x OR size from entry

YOUR PRIORITY ORDER:
1. SURVIVE — never risk more than you can afford to lose today
2. Be selective — only take A+ setups, skip anything "okay"
3. Trade WITH the trend — macro alignment is mandatory
4. Compound small wins — $100-200/day passes the combine in 15-30 days

WHEN TO SKIP (NO TRADE):
- FOMC, CPI, NFP, GDP days — zero exceptions
- VIX > 30 — too volatile for a combine account
- OR size < 20 or > 250 points — too narrow (no room) or too wide (stop too far)
- Macro signals strongly conflict — if half say bullish and half say bearish, sit out
- After 1 loss, require A++ setup. After 2 losses, stop for the day.
- Friday afternoon — avoid weekend gap risk

WHEN TO BE AGGRESSIVE:
- Calendar clear + VIX 12-18 + strong macro alignment + clean OR (50-120 pts)
- These are the A+ days — take the trade with full size

Always explain your reasoning concisely. Be specific about what data drove each decision.`

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface PreSessionDecision {
  shouldTrade: boolean
  bias: 'long' | 'short' | 'neutral'
  confidence: number
  reasoning: string
  riskLevel: 'low' | 'medium' | 'high' | 'extreme'
  adjustments: {
    bufferPoints?: number
    targetMultiple?: number
    maxContracts?: number
  }
  keyFactors: string[]
}

export interface ORAssessment {
  quality: 'excellent' | 'good' | 'fair' | 'poor'
  shouldTrade: boolean
  preferredDirection: 'long' | 'short' | 'either' | 'none'
  reasoning: string
  adjustedStop?: number
  adjustedTarget?: number
}

export interface BreakoutDecision {
  enter: boolean
  reasoning: string
  confidence: number
  contracts: number
  adjustedStop?: number
  adjustedTarget?: number
}

// ─── PRE-SESSION ANALYSIS ────────────────────────────────────────────────────
// Called once when engine starts, before market opens.
// Uses the deep model (Sonnet) because this is the most important decision
// and latency doesn't matter here.

export async function analyzePreSession(
  briefing: MarketBriefing | null,
  macro: MacroSentiment | null,
  calendarImpact: SessionImpact | null,
  accountState: {
    dailyPnl: number
    tradesCount: number
    lossesCount: number
    trailingDrawdownRemaining: number
  },
): Promise<PreSessionDecision> {
  const prompt = buildPreSessionPrompt(briefing, macro, calendarImpact, accountState)

  try {
    const response = await getClient().messages.create({
      model: DEEP_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      tools: [preSessionTool],
      tool_choice: { type: 'tool', name: 'pre_session_decision' },
    })

    const toolBlock = response.content.find((b) => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      const d = toolBlock.input as any
      console.log(`[TradingAI] Pre-session: shouldTrade=${d.shouldTrade} bias=${d.bias} confidence=${d.confidence}`)
      console.log(`[TradingAI] Reasoning: ${d.reasoning}`)
      return d as PreSessionDecision
    }
  } catch (err) {
    console.error('[TradingAI] Pre-session analysis failed:', err)
  }

  return {
    shouldTrade: true,
    bias: 'neutral',
    confidence: 50,
    reasoning: 'AI analysis unavailable — defaulting to mechanical rules',
    riskLevel: 'medium',
    adjustments: {},
    keyFactors: ['AI fallback'],
  }
}

// ─── OR ASSESSMENT ───────────────────────────────────────────────────────────
// Called once when OR locks at 10:00 AM ET.

export async function analyzeOpeningRange(
  orHigh: number,
  orLow: number,
  orSize: number,
  lastPrice: number,
  preSession: PreSessionDecision,
  briefing: MarketBriefing | null,
): Promise<ORAssessment> {
  const vwap = briefing?.vwap
  const ibs = briefing?.ibs
  const nqPrice = briefing?.nq?.price

  const prompt = `The Opening Range just locked at 10:00 AM ET. Assess this OR for trading.

OPENING RANGE:
- OR High: ${orHigh.toFixed(2)}
- OR Low: ${orLow.toFixed(2)}
- OR Size: ${orSize.toFixed(2)} points (ideal: 50-120, acceptable: 20-200)
- Current Price: ${lastPrice.toFixed(2)} (${lastPrice > orHigh ? 'ABOVE OR' : lastPrice < orLow ? 'BELOW OR' : 'INSIDE OR'})
${vwap ? `- VWAP: ${vwap.toFixed(2)} (price ${lastPrice > vwap ? 'above' : 'below'} VWAP)` : ''}
${ibs ? `- IBS: ${ibs.value} (${ibs.bias})` : ''}
${nqPrice ? `- NQ Reference: ${nqPrice.toFixed(2)}` : ''}

PRE-SESSION AI DECISION:
- Should trade: ${preSession.shouldTrade}
- Bias: ${preSession.bias}
- Confidence: ${preSession.confidence}%
- Risk level: ${preSession.riskLevel}
- Reasoning: ${preSession.reasoning}

Assess the OR quality and whether we should trade it. Consider:
1. Is the OR size in the ideal range?
2. Does the OR align with the pre-session bias?
3. Where is price relative to VWAP?
4. Is IBS suggesting any caution?
5. Are the OR boundaries clean (good for stop placement)?`

  try {
    const response = await getClient().messages.create({
      model: FAST_MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      tools: [orAssessmentTool],
      tool_choice: { type: 'tool', name: 'or_assessment' },
    })

    const toolBlock = response.content.find((b) => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      const d = toolBlock.input as any
      console.log(`[TradingAI] OR Assessment: quality=${d.quality} direction=${d.preferredDirection} shouldTrade=${d.shouldTrade}`)
      return d as ORAssessment
    }
  } catch (err) {
    console.error('[TradingAI] OR assessment failed:', err)
  }

  return {
    quality: orSize >= 50 && orSize <= 120 ? 'good' : 'fair',
    shouldTrade: preSession.shouldTrade && orSize >= 20 && orSize <= 200,
    preferredDirection: preSession.bias === 'neutral' ? 'either' : preSession.bias,
    reasoning: 'AI analysis unavailable — using mechanical OR rules',
  }
}

// ─── BREAKOUT CONFIRMATION ───────────────────────────────────────────────────
// Called when price hits trigger. Uses Haiku for speed (~200ms).

export async function analyzeBreakout(
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  stopPrice: number,
  targetPrice: number,
  orHigh: number,
  orLow: number,
  orSize: number,
  preSession: PreSessionDecision,
  orAssessment: ORAssessment,
  accountState: {
    dailyPnl: number
    tradesCount: number
    lossesCount: number
    trailingDrawdownRemaining: number
  },
): Promise<BreakoutDecision> {
  const riskPts = Math.abs(entryPrice - stopPrice)
  const rewardPts = Math.abs(targetPrice - entryPrice)
  const rrRatio = riskPts > 0 ? rewardPts / riskPts : 0
  const riskDollars = riskPts * 2 // $2/pt per contract

  const prompt = `BREAKOUT TRIGGERED — make a fast decision.

SIGNAL:
- Direction: ${direction}
- Entry: ${entryPrice.toFixed(2)}
- Stop: ${stopPrice.toFixed(2)} (${riskPts.toFixed(1)} pts risk = $${riskDollars.toFixed(0)}/contract)
- Target: ${targetPrice.toFixed(2)} (${rewardPts.toFixed(1)} pts reward)
- R:R Ratio: ${rrRatio.toFixed(2)}:1
- OR: ${orHigh.toFixed(2)} / ${orLow.toFixed(2)} (${orSize.toFixed(1)} pts)

ACCOUNT STATE:
- Daily P&L: $${accountState.dailyPnl.toFixed(0)}
- Trades today: ${accountState.tradesCount}/2
- Losses today: ${accountState.lossesCount}/2
- Trailing drawdown remaining: $${accountState.trailingDrawdownRemaining.toFixed(0)}

PRE-SESSION: bias=${preSession.bias}, confidence=${preSession.confidence}%, risk=${preSession.riskLevel}
OR QUALITY: ${orAssessment.quality}, preferred=${orAssessment.preferredDirection}

CRITICAL CHECKS:
1. Does ${direction} align with pre-session bias (${preSession.bias})?
2. Is R:R >= 1.5:1?
3. Would a loss here breach daily limit ($${(1000 + accountState.dailyPnl).toFixed(0)} remaining)?
4. Is the OR assessment favorable?
5. Has the AI confidence been high enough today?

Enter or skip? If entering, how many contracts (1 or 2)?`

  try {
    const response = await getClient().messages.create({
      model: FAST_MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      tools: [breakoutTool],
      tool_choice: { type: 'tool', name: 'breakout_decision' },
    })

    const toolBlock = response.content.find((b) => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      const d = toolBlock.input as any
      console.log(`[TradingAI] Breakout: enter=${d.enter} contracts=${d.contracts} confidence=${d.confidence}`)
      console.log(`[TradingAI] Reasoning: ${d.reasoning}`)
      return d as BreakoutDecision
    }
  } catch (err) {
    console.error('[TradingAI] Breakout analysis failed:', err)
  }

  return {
    enter: preSession.shouldTrade && orAssessment.shouldTrade,
    reasoning: 'AI analysis unavailable — using mechanical rules',
    confidence: 50,
    contracts: 1,
  }
}

// ─── TOOL DEFINITIONS ───────────────────────────────────────────────────────

const preSessionTool: Anthropic.Tool = {
  name: 'pre_session_decision',
  description: 'Make a pre-session trading decision based on all available market data',
  input_schema: {
    type: 'object' as const,
    properties: {
      shouldTrade: {
        type: 'boolean',
        description: 'Whether to trade today. False = sit out entirely.',
      },
      bias: {
        type: 'string',
        enum: ['long', 'short', 'neutral'],
        description: 'Directional bias for today. Only take trades in this direction (or either if neutral).',
      },
      confidence: {
        type: 'number',
        description: 'Confidence level 0-100. Below 60 = skip. 60-79 = cautious (1 contract). 80+ = full size.',
      },
      reasoning: {
        type: 'string',
        description: 'Concise explanation of the decision (2-3 sentences). Reference specific data points.',
      },
      riskLevel: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'extreme'],
        description: 'Overall risk level for today.',
      },
      adjustments: {
        type: 'object',
        properties: {
          bufferPoints: { type: 'number', description: 'Override buffer (default 3). Increase on volatile days.' },
          targetMultiple: { type: 'number', description: 'Override target multiple (default 1.5x). Decrease on choppy days.' },
          maxContracts: { type: 'number', description: 'Override max contracts (default 2). Reduce to 1 on high-risk days.' },
        },
      },
      keyFactors: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of 3-5 key factors that drove the decision.',
      },
    },
    required: ['shouldTrade', 'bias', 'confidence', 'reasoning', 'riskLevel', 'keyFactors'],
  },
}

const orAssessmentTool: Anthropic.Tool = {
  name: 'or_assessment',
  description: 'Assess the quality of the opening range for ORB trading',
  input_schema: {
    type: 'object' as const,
    properties: {
      quality: {
        type: 'string',
        enum: ['excellent', 'good', 'fair', 'poor'],
        description: 'OR quality rating.',
      },
      shouldTrade: {
        type: 'boolean',
        description: 'Whether to trade this OR.',
      },
      preferredDirection: {
        type: 'string',
        enum: ['long', 'short', 'either', 'none'],
        description: 'Preferred breakout direction based on context.',
      },
      reasoning: {
        type: 'string',
        description: 'Concise reasoning (1-2 sentences).',
      },
    },
    required: ['quality', 'shouldTrade', 'preferredDirection', 'reasoning'],
  },
}

const breakoutTool: Anthropic.Tool = {
  name: 'breakout_decision',
  description: 'Decide whether to enter a breakout trade',
  input_schema: {
    type: 'object' as const,
    properties: {
      enter: {
        type: 'boolean',
        description: 'Whether to enter this trade.',
      },
      reasoning: {
        type: 'string',
        description: 'Concise reasoning (1-2 sentences).',
      },
      confidence: {
        type: 'number',
        description: 'Confidence 0-100.',
      },
      contracts: {
        type: 'number',
        description: 'Number of contracts (1 or 2).',
      },
    },
    required: ['enter', 'reasoning', 'confidence', 'contracts'],
  },
}

// ─── PROMPT BUILDER ─────────────────────────────────────────────────────────

function buildPreSessionPrompt(
  briefing: MarketBriefing | null,
  macro: MacroSentiment | null,
  calendarImpact: SessionImpact | null,
  accountState: { dailyPnl: number; tradesCount: number; lossesCount: number; trailingDrawdownRemaining: number },
): string {
  const sections: string[] = []

  sections.push(`Analyze today's conditions and decide: should we trade the ORB on MNQ today?`)

  if (briefing) {
    sections.push(`\nMARKET DATA:`)
    if (briefing.nq) sections.push(`- NQ Price: ${briefing.nq.price.toFixed(2)} (${briefing.nq.changePct >= 0 ? '+' : ''}${briefing.nq.changePct}%)`)
    if (briefing.vix) sections.push(`- VIX: ${briefing.vix.level} (${briefing.vix.status}) ${briefing.vix.extreme ? '⛔ EXTREME' : briefing.vix.elevated ? '⚠️ ELEVATED' : '✓ Normal'}`)
    if (briefing.qqq) {
      sections.push(`- QQQ: $${briefing.qqq.price.toFixed(2)} (${briefing.qqq.regularChangePct >= 0 ? '+' : ''}${briefing.qqq.regularChangePct}%, ${briefing.qqq.direction})`)
      if (briefing.qqq.premarketChangePct != null) sections.push(`- QQQ Pre-market: ${briefing.qqq.premarketChangePct >= 0 ? '+' : ''}${briefing.qqq.premarketChangePct}%`)
    }
    if (briefing.ibs) sections.push(`- IBS: ${briefing.ibs.value} (${briefing.ibs.bias})`)
    if (briefing.vwap) sections.push(`- VWAP: ${briefing.vwap.toFixed(2)}`)
    if (briefing.nq) {
      sections.push(`- Overnight Range: ${briefing.nq.overnightHigh.toFixed(2)} / ${briefing.nq.overnightLow.toFixed(2)}`)
    }
  }

  if (macro) {
    sections.push(`\nMACRO SENTIMENT:`)
    if (macro.fearGreed) sections.push(`- Fear & Greed: ${macro.fearGreed.score} (${macro.fearGreed.rating}, ${macro.fearGreed.direction})`)
    if (macro.us10y) sections.push(`- US 10Y: ${macro.us10y.current}% (${macro.us10y.direction} → ${macro.us10y.nqImpact} for NQ)`)
    if (macro.dxy) sections.push(`- DXY: ${macro.dxy.current} (${macro.dxy.direction} → ${macro.dxy.nqImpact} for NQ)`)
    if (macro.es) sections.push(`- ES Futures: ${macro.es.changePct >= 0 ? '+' : ''}${macro.es.changePct}% (${macro.es.direction})`)
    sections.push(`- Overall NQ Bias: ${macro.nqBias}`)
    if (macro.bullishSignals.length) sections.push(`- Bullish: ${macro.bullishSignals.join('; ')}`)
    if (macro.bearishSignals.length) sections.push(`- Bearish: ${macro.bearishSignals.join('; ')}`)
  }

  if (calendarImpact) {
    sections.push(`\nECONOMIC CALENDAR:`)
    sections.push(`- Verdict: ${calendarImpact.verdict} — ${calendarImpact.verdictLabel}`)
    if (calendarImpact.keyEvents.length) {
      for (const e of calendarImpact.keyEvents) {
        sections.push(`  • ${e.time}: ${e.title} (${e.risk} risk) — ${e.note}`)
      }
    }
    if (calendarImpact.avoidWindows.length) {
      sections.push(`- Avoid windows: ${calendarImpact.avoidWindows.join(', ')}`)
    }
  }

  sections.push(`\nACCOUNT STATE:`)
  sections.push(`- Daily P&L: $${accountState.dailyPnl.toFixed(0)}`)
  sections.push(`- Trades today: ${accountState.tradesCount}/2`)
  sections.push(`- Losses today: ${accountState.lossesCount}/2`)
  sections.push(`- Remaining daily risk: $${(1000 + accountState.dailyPnl).toFixed(0)}`)
  sections.push(`- Trailing drawdown remaining: $${accountState.trailingDrawdownRemaining.toFixed(0)}`)

  sections.push(`\nMake your pre-session decision. Should we trade today?`)

  return sections.join('\n')
}
