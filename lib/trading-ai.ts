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
import type { OrderflowAssessment } from './orderflow'

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
- Max contracts allowed: 5 MNQ

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

POSITION SIZING (1-5 MNQ contracts):
You must intelligently scale position size based on setup quality and risk.
The key formula: contracts × stop_distance × $2 = dollar risk per trade.
This dollar risk must NEVER exceed daily loss remaining.

SIZING GUIDE:
- 1 contract: Low confidence (<65%), after a loss, high VIX (>22), wide OR (>150pts), conflicting signals, drawdown within $600 of limit
- 2 contracts: Moderate confidence (65-74%), decent setup but some uncertainty, elevated VIX (18-22), OR 100-150 pts
- 3 contracts: Good confidence (75-84%), solid macro alignment, clean OR (60-100 pts), calendar clear, VIX normal
- 4 contracts: High confidence (85-92%), everything aligned, ideal OR (50-80 pts), VIX low (12-16), strong trend day
- 5 contracts: Maximum conviction (93%+), A++ setup, perfect macro alignment, ideal OR, no news, VIX <15, first trade of day with no losses — RARE, maybe 1-2 days/month

CRITICAL SIZING RULES:
- ALWAYS check: contracts × stop_distance_pts × $2 < remaining daily loss budget
- After 1 loss: MAX 2 contracts regardless of setup quality
- Trailing drawdown within $800: MAX 2 contracts
- Trailing drawdown within $400: MAX 1 contract
- Never size up after a loss — only maintain or reduce
- If daily P&L is positive, you can size slightly more aggressively (house money effect)
- If daily P&L is negative, reduce size proportionally

WHEN TO SKIP (NO TRADE):
- FOMC, CPI, NFP, GDP days — zero exceptions
- VIX > 30 — too volatile for a combine account
- OR size < 20 or > 250 points — too narrow (no room) or too wide (stop too far)
- Macro signals strongly conflict — if half say bullish and half say bearish, sit out
- After 2 losses, stop for the day.
- Friday afternoon — avoid weekend gap risk

Always explain your reasoning concisely. Be specific about what data drove each decision, especially the contract count.`

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
  orderflow: OrderflowAssessment | null = null,
): Promise<BreakoutDecision> {
  const riskPts = Math.abs(entryPrice - stopPrice)
  const rewardPts = Math.abs(targetPrice - entryPrice)
  const rrRatio = riskPts > 0 ? rewardPts / riskPts : 0
  const riskDollars = riskPts * 2 // $2/pt per contract

  const dailyBudgetRemaining = 1000 + accountState.dailyPnl
  const maxContractsByRisk = riskDollars > 0 ? Math.floor(dailyBudgetRemaining / riskDollars) : 1
  const maxContractsByDrawdown = riskDollars > 0 ? Math.floor(accountState.trailingDrawdownRemaining / riskDollars) : 1
  const hardCap = Math.min(5, maxContractsByRisk, maxContractsByDrawdown)

  const prompt = `BREAKOUT TRIGGERED — decide entry and position size.

SIGNAL:
- Direction: ${direction}
- Entry: ${entryPrice.toFixed(2)}
- Stop: ${stopPrice.toFixed(2)} (${riskPts.toFixed(1)} pts risk = $${riskDollars.toFixed(0)}/contract)
- Target: ${targetPrice.toFixed(2)} (${rewardPts.toFixed(1)} pts reward)
- R:R Ratio: ${rrRatio.toFixed(2)}:1
- OR: ${orHigh.toFixed(2)} / ${orLow.toFixed(2)} (${orSize.toFixed(1)} pts)

POSITION SIZING MATH:
- Risk per contract: $${riskDollars.toFixed(0)}
- 1 contract = $${riskDollars.toFixed(0)} risk
- 2 contracts = $${(riskDollars * 2).toFixed(0)} risk
- 3 contracts = $${(riskDollars * 3).toFixed(0)} risk
- 4 contracts = $${(riskDollars * 4).toFixed(0)} risk
- 5 contracts = $${(riskDollars * 5).toFixed(0)} risk
- MAX SAFE: ${hardCap} contracts (limited by daily budget $${dailyBudgetRemaining.toFixed(0)} and drawdown $${accountState.trailingDrawdownRemaining.toFixed(0)})

ACCOUNT STATE:
- Daily P&L: $${accountState.dailyPnl.toFixed(0)}
- Daily loss budget remaining: $${dailyBudgetRemaining.toFixed(0)}
- Trades today: ${accountState.tradesCount}/2
- Losses today: ${accountState.lossesCount}/2
- Trailing drawdown remaining: $${accountState.trailingDrawdownRemaining.toFixed(0)}

CONTEXT:
- Pre-session: bias=${preSession.bias}, confidence=${preSession.confidence}%, risk=${preSession.riskLevel}
- OR quality: ${orAssessment.quality}, preferred=${orAssessment.preferredDirection}
${accountState.lossesCount > 0 ? '- WARNING: Already took a loss today — max 2 contracts after a loss' : ''}
${accountState.trailingDrawdownRemaining < 800 ? '- DANGER: Drawdown within $800 — max 2 contracts' : ''}
${accountState.trailingDrawdownRemaining < 400 ? '- CRITICAL: Drawdown within $400 — max 1 contract only' : ''}
${orderflow && orderflow.available
  ? `\nORDER FLOW (live tape + DOM):
- Cumulative delta: ${orderflow.cumDelta} | recent-window delta: ${orderflow.shortDelta} (${orderflow.deltaConfirms ? 'confirms' : 'DIVERGES from'} the ${direction})
- Delta divergence: ${orderflow.divergence} | resting wall ahead: ${orderflow.wallRisk} (${orderflow.resistanceVol} ahead vs ${orderflow.supportVol} behind)
- Order-flow read: ${orderflow.verdict.toUpperCase()} — ${orderflow.reasons.join('; ')}${orderflow.verdict === 'caution' ? '\n  ⚠️ Flow is cautious: require strong conviction or size down.' : ''}`
  : '\nORDER FLOW: unavailable/stale — decide on price action + context only.'}

Enter or skip? If entering, choose contracts (1-${hardCap}) based on confidence and risk.`

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
        description: 'Confidence level 0-100. Below 60 = skip. 60-74 = 1-2 contracts. 75-84 = 2-3. 85-92 = 3-4. 93+ = up to 5.',
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
          maxContracts: { type: 'number', description: 'Daily max contracts (1-5). Scale with conditions: 1=danger, 2=cautious, 3=normal, 4=confident, 5=A++ only.' },
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
  description: 'Decide whether to enter a breakout trade and how many contracts',
  input_schema: {
    type: 'object' as const,
    properties: {
      enter: {
        type: 'boolean',
        description: 'Whether to enter this trade.',
      },
      reasoning: {
        type: 'string',
        description: 'Concise reasoning (2-3 sentences). Must explain the contract count choice with specific dollar risk math.',
      },
      confidence: {
        type: 'number',
        description: 'Confidence 0-100. Drives sizing: <60=skip, 60-74=1-2, 75-84=2-3, 85-92=3-4, 93+=up to 5.',
      },
      contracts: {
        type: 'number',
        description: 'Number of MNQ contracts (1-5). MUST respect risk limits: contracts × risk_per_contract < daily budget remaining. After a loss, max 2.',
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

// ─── SESSION DEBRIEF ───────────────────────────────────────────────────────
// Post-close written assessment of the day — what we traded, what we vetoed and
// why, and how order flow shaped it. Plain text for Telegram.

export interface SessionDebriefTrade {
  direction: 'LONG' | 'SHORT'
  entryPrice: number
  exitPrice: number
  contracts: number
  resultPts: number
  resultDollars: number
  status: 'WIN' | 'LOSS' | 'BE'
  entryTime: string
  exitTime: string
}

export interface SessionDebriefInput {
  date: string
  orHigh: number | null
  orLow: number | null
  orSize: number | null
  preSession: PreSessionDecision | null
  orAssessment: ORAssessment | null
  trades: SessionDebriefTrade[]
  dailyPnl: number
  winsCount: number
  lossesCount: number
  vetoCount: number
  vetoReasons: string[]
}

function mechanicalDebrief(i: SessionDebriefInput): string {
  const wr = i.trades.length ? Math.round((i.winsCount / i.trades.length) * 100) : 0
  const lines = [
    `📋 <b>SESSION DEBRIEF</b> — ${i.date}`,
    i.orHigh && i.orLow ? `OR: ${i.orHigh} / ${i.orLow} (${i.orSize?.toFixed(0)} pts)` : 'OR: not captured',
    `Trades: ${i.trades.length} · W/L: ${i.winsCount}/${i.lossesCount} (${wr}%) · P&L: $${i.dailyPnl >= 0 ? '+' : ''}${i.dailyPnl.toFixed(2)}`,
  ]
  if (i.vetoCount > 0) lines.push(`Order-flow vetoes: ${i.vetoCount}`)
  return lines.join('\n')
}

export async function summarizeSession(input: SessionDebriefInput): Promise<string> {
  const prompt = buildDebriefPrompt(input)
  try {
    const response = await getClient().messages.create({
      model: FAST_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    })
    const block = response.content.find((b) => b.type === 'text')
    if (block && block.type === 'text' && block.text.trim()) {
      return `🧠 <b>SESSION DEBRIEF</b> — ${input.date}\n\n${block.text.trim()}`
    }
  } catch (err) {
    console.error('[TradingAI] Session debrief failed:', err)
  }
  return mechanicalDebrief(input)
}

function buildDebriefPrompt(i: SessionDebriefInput): string {
  const sec: string[] = []
  sec.push(
    `Write a concise end-of-session debrief (4-6 sentences) on how today's ORB paper session went. ` +
    `Be specific and honest — credit good discipline, call out mistakes. Plain text, no markdown headers or bullet symbols.`,
  )
  sec.push(`\nDATE: ${i.date}`)
  if (i.orHigh && i.orLow) sec.push(`OPENING RANGE: ${i.orHigh} / ${i.orLow} (${i.orSize?.toFixed(0)} pts)`)
  if (i.preSession) sec.push(`PRE-SESSION: trade=${i.preSession.shouldTrade}, bias=${i.preSession.bias}, conf=${i.preSession.confidence}% — ${i.preSession.reasoning}`)
  if (i.orAssessment) sec.push(`OR ASSESSMENT: ${i.orAssessment.quality}, prefers ${i.orAssessment.preferredDirection} — ${i.orAssessment.reasoning}`)

  sec.push(`\nTRADES (${i.trades.length}):`)
  if (i.trades.length === 0) sec.push(`- none taken`)
  for (const t of i.trades) {
    sec.push(`- ${t.entryTime} ${t.direction} ${t.contracts} @ ${t.entryPrice} → ${t.exitPrice} = ${t.status} ${t.resultPts >= 0 ? '+' : ''}${t.resultPts}pts ($${t.resultDollars >= 0 ? '+' : ''}${t.resultDollars.toFixed(0)})`)
  }
  sec.push(`\nDAILY P&L: $${i.dailyPnl >= 0 ? '+' : ''}${i.dailyPnl.toFixed(2)} | W/L: ${i.winsCount}/${i.lossesCount}`)

  if (i.vetoCount > 0) {
    sec.push(`\nORDER-FLOW VETOES (${i.vetoCount}) — breakouts skipped because the tape/DOM didn't back them:`)
    for (const r of i.vetoReasons.slice(0, 5)) sec.push(`- ${r}`)
  }

  sec.push(`\nAssess: did we follow the plan? Was sitting out / vetoing the right call given the outcome? One thing to watch next session. Keep it tight and useful.`)
  return sec.join('\n')
}
