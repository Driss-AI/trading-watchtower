// ─── ECONOMIC CALENDAR INTELLIGENCE ──────────────────────────────────────────
// For each major USD economic event: what it is, how it moves NQ, and
// what an ORB trader should do about it.

export interface EventIntel {
  // What this event actually measures (plain English)
  description: string
  // How markets typically react to a SURPRISE (beat or miss)
  nqReaction: 'volatile' | 'directional' | 'minor'
  // Which direction a BETTER-than-expected reading pushes NQ
  beatDirection: 'bullish' | 'bearish' | 'mixed'
  // Risk level for ORB trading
  orbRisk: 'extreme' | 'high' | 'medium' | 'low'
  // Minutes before event to stop trading
  avoidBefore: number
  // Minutes after event to wait before re-entering
  avoidAfter: number
  // Specific advice for NQ ORB traders
  traderNote: string
  // Why it matters for NQ specifically
  nqContext: string
}

// Comprehensive lookup: event title keyword → intel
// Keys are lowercase substrings that match Forex Factory titles
const EVENT_INTEL: Record<string, EventIntel> = {

  // ─── TIER 1: MARKET MOVERS (EXTREME RISK) ────────────────────────────────

  'fomc': {
    description: 'Federal Reserve interest rate decision + statement',
    nqReaction: 'volatile',
    beatDirection: 'mixed',
    orbRisk: 'extreme',
    avoidBefore: 60,
    avoidAfter: 60,
    traderNote: '⛔ NO TRADE. FOMC causes multi-hundred point NQ swings. Even with a good setup, one sentence in the statement can reverse everything instantly.',
    nqContext: 'NQ is extremely sensitive to rate decisions. Lower rates = bullish, higher = bearish, but the press conference wording can flip direction 3 times in one hour.',
  },

  'federal funds rate': {
    description: 'Federal Reserve interest rate decision',
    nqReaction: 'volatile',
    beatDirection: 'mixed',
    orbRisk: 'extreme',
    avoidBefore: 60,
    avoidAfter: 60,
    traderNote: '⛔ NO TRADE. Same as FOMC — this IS the rate decision.',
    nqContext: 'The single biggest scheduled risk event for NQ.',
  },

  'cpi': {
    description: 'Consumer Price Index — measures retail inflation (what you pay at the store)',
    nqReaction: 'volatile',
    beatDirection: 'bearish',
    orbRisk: 'extreme',
    avoidBefore: 30,
    avoidAfter: 45,
    traderNote: '⛔ NO TRADE. CPI drops at 8:30 AM ET — right before the NY open. The OR itself will be distorted by the reaction. Skip the entire session.',
    nqContext: 'Hot CPI (higher than expected) = Fed raises rates = bad for growth stocks = NQ sells off hard. Cool CPI = Fed cuts = NQ rips. Either way: violent move.',
  },

  'core cpi': {
    description: 'CPI excluding food and energy — the Fed\'s preferred inflation gauge',
    nqReaction: 'volatile',
    beatDirection: 'bearish',
    orbRisk: 'extreme',
    avoidBefore: 30,
    avoidAfter: 45,
    traderNote: '⛔ NO TRADE. Same rule as CPI — this is the number the Fed actually watches.',
    nqContext: 'Fed decisions are driven by Core CPI. A surprise here changes rate expectations immediately.',
  },

  'pce': {
    description: 'Personal Consumption Expenditures — Fed\'s official preferred inflation measure',
    nqReaction: 'volatile',
    beatDirection: 'bearish',
    orbRisk: 'extreme',
    avoidBefore: 30,
    avoidAfter: 45,
    traderNote: '⛔ NO TRADE. The Fed literally targets PCE. Any surprise creates immediate repricing of rate expectations.',
    nqContext: 'Even more important than CPI for Fed decisions. Hot PCE = rate hike fear = NQ dumps.',
  },

  'non-farm': {
    description: 'Non-Farm Payrolls — monthly US jobs report (how many jobs were added)',
    nqReaction: 'volatile',
    beatDirection: 'mixed',
    orbRisk: 'extreme',
    avoidBefore: 30,
    avoidAfter: 60,
    traderNote: '⛔ NO TRADE. NFP drops at 8:30 AM ET first Friday of the month. One of the biggest market events of the month — unpredictable direction.',
    nqContext: 'Strong jobs = Fed won\'t cut = bearish for NQ. Weak jobs = recession fear = also bearish. In-line = relief rally. Direction is genuinely unpredictable.',
  },

  'nfp': {
    description: 'Non-Farm Payrolls (NFP) — monthly US jobs report',
    nqReaction: 'volatile',
    beatDirection: 'mixed',
    orbRisk: 'extreme',
    avoidBefore: 30,
    avoidAfter: 60,
    traderNote: '⛔ NO TRADE. First Friday of every month. Skip it entirely.',
    nqContext: 'Same as Non-Farm Payrolls.',
  },

  'gdp': {
    description: 'Gross Domestic Product — total economic output of the US',
    nqReaction: 'volatile',
    beatDirection: 'bullish',
    orbRisk: 'extreme',
    avoidBefore: 30,
    avoidAfter: 45,
    traderNote: '⛔ NO TRADE. GDP reports (especially advance and preliminary) move markets sharply.',
    nqContext: 'Strong GDP = economy healthy = good for stocks broadly. But if too strong, Fed won\'t cut. Weak GDP = recession fear = NQ sells hard.',
  },

  // ─── TIER 2: HIGH RISK ────────────────────────────────────────────────────

  'ppi': {
    description: 'Producer Price Index — measures wholesale/factory-gate inflation',
    nqReaction: 'directional',
    beatDirection: 'bearish',
    orbRisk: 'high',
    avoidBefore: 20,
    avoidAfter: 30,
    traderNote: '⚠️ CAUTION. PPI is a leading indicator for CPI. Hot PPI often means CPI will be hot next month. Markets react but less violently than CPI.',
    nqContext: 'Drops at 8:30 AM ET. Watch for the initial 5-min spike, then look for OR to establish after 9:45-10:00.',
  },

  'retail sales': {
    description: 'Monthly retail spending — measures consumer health',
    nqReaction: 'directional',
    beatDirection: 'bullish',
    orbRisk: 'high',
    avoidBefore: 20,
    avoidAfter: 30,
    traderNote: '⚠️ CAUTION. Retail Sales drops at 8:30 AM ET. Strong consumer spending is bullish for tech/NQ but could delay Fed cuts.',
    nqContext: 'Consumer spending drives tech company revenues. Beat = NQ often rallies initially. Miss = growth fear.',
  },

  'initial jobless': {
    description: 'Weekly unemployment insurance claims — how many people filed for unemployment',
    nqReaction: 'directional',
    beatDirection: 'bullish',
    orbRisk: 'high',
    avoidBefore: 15,
    avoidAfter: 20,
    traderNote: '⚠️ CAUTION. Weekly at 8:30 AM ET every Thursday. Lower claims (fewer people filing) = bullish. Higher claims = labor market softening.',
    nqContext: 'Weekly data so less dramatic than NFP, but consistent surprises build narrative. If claims are much higher than expected, NQ often dips at open.',
  },

  'jobless claims': {
    description: 'Weekly unemployment claims',
    nqReaction: 'directional',
    beatDirection: 'bullish',
    orbRisk: 'high',
    avoidBefore: 15,
    avoidAfter: 20,
    traderNote: '⚠️ CAUTION. Every Thursday 8:30 AM ET. Lower number = fewer layoffs = bullish for NQ.',
    nqContext: 'Same as Initial Jobless Claims.',
  },

  'ism manufacturing': {
    description: 'ISM Manufacturing PMI — factory activity survey (above 50 = expansion)',
    nqReaction: 'directional',
    beatDirection: 'bullish',
    orbRisk: 'high',
    avoidBefore: 15,
    avoidAfter: 25,
    traderNote: '⚠️ CAUTION. Drops at 10:00 AM ET — 15 minutes after the (15-min) OR locks. The release will move price inside the trade window; expect a fake breakout right after the print.',
    nqContext: 'First business day of each month. Reading above 50 = factories expanding. Tech sector is sensitive to manufacturing health.',
  },

  'ism services': {
    description: 'ISM Services PMI — service sector activity (above 50 = expansion)',
    nqReaction: 'directional',
    beatDirection: 'bullish',
    orbRisk: 'high',
    avoidBefore: 15,
    avoidAfter: 25,
    traderNote: '⚠️ CAUTION. Drops at 10:00 AM ET third business day. Services is 70%+ of US economy — a big miss here moves markets.',
    nqContext: 'Service sector dominates the US economy. Includes tech services. Strong ISM Services = NQ often bullish.',
  },

  'jolts': {
    description: 'Job Openings and Labor Turnover Survey — how many job openings exist',
    nqReaction: 'directional',
    beatDirection: 'mixed',
    orbRisk: 'high',
    avoidBefore: 15,
    avoidAfter: 20,
    traderNote: '⚠️ CAUTION. 10:00 AM ET. Fed watches this closely for labor market tightness. Too many openings = Fed won\'t cut.',
    nqContext: 'High job openings = labor market tight = Fed keeps rates high = NQ under pressure. This has become more market-moving post-COVID.',
  },

  'fomc minutes': {
    description: 'Detailed minutes from the previous Fed meeting — shows what members discussed',
    nqReaction: 'directional',
    beatDirection: 'mixed',
    orbRisk: 'high',
    avoidBefore: 15,
    avoidAfter: 30,
    traderNote: '⚠️ CAUTION. Released at 2:00 PM ET — after your session. But can cause late-day volatility that carries into next morning.',
    nqContext: 'Minutes reveal hawkish/dovish bias. Can shift rate expectations and affect next day\'s open.',
  },

  'fed chair': {
    description: 'Federal Reserve Chair speaking — live commentary on economy/rates',
    nqReaction: 'volatile',
    beatDirection: 'mixed',
    orbRisk: 'extreme',
    avoidBefore: 30,
    avoidAfter: 45,
    traderNote: '⛔ NO TRADE if Powell/Fed Chair speaks during or near your session. One off-script word about rates can move NQ 100+ points instantly.',
    nqContext: 'Chair speeches can be as market-moving as FOMC decisions. Completely unpredictable direction.',
  },

  'powell': {
    description: 'Fed Chair Powell speaking',
    nqReaction: 'volatile',
    beatDirection: 'mixed',
    orbRisk: 'extreme',
    avoidBefore: 30,
    avoidAfter: 45,
    traderNote: '⛔ NO TRADE. Powell speaks = markets on edge. Skip the session.',
    nqContext: 'Same as Fed Chair — immediate market impact on any rate commentary.',
  },

  // ─── TIER 3: MEDIUM RISK ────────────────────────────────────────────────────

  'consumer confidence': {
    description: 'Conference Board survey of how confident consumers feel about the economy',
    nqReaction: 'directional',
    beatDirection: 'bullish',
    orbRisk: 'medium',
    avoidBefore: 10,
    avoidAfter: 15,
    traderNote: '🟡 MANAGEABLE. 10:00 AM ET. Less dramatic than CPI/NFP but can add to existing bias. If confidence beats expectations, confirms bullish direction.',
    nqContext: 'Consumer confidence → consumer spending → tech company revenues. Strong reading slightly bullish for NQ.',
  },

  'michigan': {
    description: 'University of Michigan Consumer Sentiment — monthly consumer mood survey',
    nqReaction: 'directional',
    beatDirection: 'bullish',
    orbRisk: 'medium',
    avoidBefore: 10,
    avoidAfter: 15,
    traderNote: '🟡 MANAGEABLE. Usually 10:00 AM ET on Fridays. Less impactful than Conference Board. Watch for inflation expectations component — that can surprise.',
    nqContext: 'Contains inflation expectations — if consumers expect high inflation, Fed must act. That component gets most attention.',
  },

  'housing starts': {
    description: 'New residential construction starts — health of housing market',
    nqReaction: 'minor',
    beatDirection: 'bullish',
    orbRisk: 'low',
    avoidBefore: 5,
    avoidAfter: 10,
    traderNote: '✓ LOW RISK. Housing data rarely moves NQ significantly. Trade normally, just be aware of the 8:30 AM print.',
    nqContext: 'Housing is rate-sensitive but less directly tied to tech/NQ. Usually background noise.',
  },

  'building permits': {
    description: 'Permits issued for future construction — leading housing indicator',
    nqReaction: 'minor',
    beatDirection: 'bullish',
    orbRisk: 'low',
    avoidBefore: 5,
    avoidAfter: 10,
    traderNote: '✓ LOW RISK. Rarely moves NQ. Trade your plan normally.',
    nqContext: 'Very limited direct impact on tech/NQ.',
  },

  'durable goods': {
    description: 'Orders for long-lasting manufactured goods (aircraft, machinery, appliances)',
    nqReaction: 'directional',
    beatDirection: 'bullish',
    orbRisk: 'medium',
    avoidBefore: 10,
    avoidAfter: 15,
    traderNote: '🟡 MANAGEABLE. 8:30 AM ET. Business investment signal — ex-aircraft is the clean read. Big miss can spook markets.',
    nqContext: 'Tells you if businesses are investing. Weak durable goods = companies cutting capex = cautious for NQ.',
  },

  'trade balance': {
    description: 'Difference between US exports and imports',
    nqReaction: 'minor',
    beatDirection: 'mixed',
    orbRisk: 'low',
    avoidBefore: 5,
    avoidAfter: 10,
    traderNote: '✓ LOW RISK. Trade data rarely causes significant NQ moves unless there is a major tariff context.',
    nqContext: 'Usually ignored by NQ traders unless there is active trade war news.',
  },

  'existing home sales': {
    description: 'Monthly sales of previously-owned homes',
    nqReaction: 'minor',
    beatDirection: 'bullish',
    orbRisk: 'low',
    avoidBefore: 5,
    avoidAfter: 10,
    traderNote: '✓ LOW RISK. Housing data does not meaningfully move NQ. Trade your setup.',
    nqContext: 'Background noise for NQ. Focus on your OR setup.',
  },

  'new home sales': {
    description: 'Monthly sales of newly built homes',
    nqReaction: 'minor',
    beatDirection: 'bullish',
    orbRisk: 'low',
    avoidBefore: 5,
    avoidAfter: 10,
    traderNote: '✓ LOW RISK. Rarely moves NQ. Proceed with session normally.',
    nqContext: 'Low direct relevance to NQ/tech sector.',
  },

  'crude oil inventories': {
    description: 'Weekly US oil stockpile levels — released by EIA every Wednesday',
    nqReaction: 'minor',
    beatDirection: 'mixed',
    orbRisk: 'low',
    avoidBefore: 5,
    avoidAfter: 10,
    traderNote: '✓ LOW RISK for NQ. Oil inventory affects energy stocks and CL/oil futures but has minimal direct NQ impact unless oil moves dramatically.',
    nqContext: 'Only matters if oil is already making big moves. Otherwise safe to trade NQ through this.',
  },

  'treasury': {
    description: 'US Treasury bond auction — government sells new debt to investors',
    nqReaction: 'minor',
    beatDirection: 'mixed',
    orbRisk: 'low',
    avoidBefore: 5,
    avoidAfter: 10,
    traderNote: '✓ LOW RISK usually. Weak demand at auctions can push yields higher (bad for NQ) but impact is usually brief.',
    nqContext: 'Watch bid-to-cover ratio — low demand = yields spike = NQ dips briefly.',
  },
}

// ─── MAIN LOOKUP FUNCTION ─────────────────────────────────────────────────────

export function getEventIntel(eventTitle: string): EventIntel | null {
  const lower = eventTitle.toLowerCase()
  for (const [keyword, intel] of Object.entries(EVENT_INTEL)) {
    if (lower.includes(keyword)) return intel
  }
  return null
}

// ─── SESSION IMPACT SUMMARY ───────────────────────────────────────────────────
// Given today's events, produce a single clear trading verdict

export interface SessionImpact {
  verdict: 'NO_TRADE' | 'CAUTION' | 'TRADE_WITH_CARE' | 'CLEAR'
  verdictLabel: string
  verdictColor: string
  reasons: string[]           // short reason for each risky event
  avoidWindows: string[]      // specific time windows to avoid
  scoreAdjustment: number     // suggested penalty to apply to session score
  keyEvents: Array<{ title: string; time: string; risk: string; note: string }>
}

export function getSessionImpact(events: Array<{ title: string; time: string; impact: string }>): SessionImpact {
  const reasons: string[] = []
  const avoidWindows: string[] = []
  const keyEvents: SessionImpact['keyEvents'] = []
  let highestRisk: 'extreme' | 'high' | 'medium' | 'low' = 'low'
  let scoreAdj = 0

  for (const event of events) {
    const intel = getEventIntel(event.title)
    if (!intel) continue

    // Track highest risk
    const riskOrder = { extreme: 4, high: 3, medium: 2, low: 1 }
    if (riskOrder[intel.orbRisk] > riskOrder[highestRisk]) {
      highestRisk = intel.orbRisk
    }

    // Score penalties
    if (intel.orbRisk === 'extreme') scoreAdj -= 30
    else if (intel.orbRisk === 'high') scoreAdj -= 15
    else if (intel.orbRisk === 'medium') scoreAdj -= 5

    // Avoid window (for events near session 9:30-10:30 ET)
    if (event.time && event.time !== 'All Day' && (intel.orbRisk === 'extreme' || intel.orbRisk === 'high')) {
      avoidWindows.push(`${event.time}: ${event.title} — avoid ±${intel.avoidAfter} min`)
    }

    reasons.push(`${event.title} (${event.time}): ${intel.orbRisk.toUpperCase()} risk`)

    keyEvents.push({
      title: event.title,
      time: event.time,
      risk: intel.orbRisk,
      note: intel.traderNote,
    })
  }

  // Cap score adjustment
  scoreAdj = Math.max(scoreAdj, -30)

  // Verdict
  let verdict: SessionImpact['verdict']
  let verdictLabel: string
  let verdictColor: string

  if (highestRisk === 'extreme') {
    verdict = 'NO_TRADE'
    verdictLabel = '⛔ NO TRADE — Extreme event today'
    verdictColor = 'red'
  } else if (highestRisk === 'high') {
    verdict = 'CAUTION'
    verdictLabel = '⚠️ CAUTION — High-impact event today'
    verdictColor = 'yellow'
  } else if (highestRisk === 'medium') {
    verdict = 'TRADE_WITH_CARE'
    verdictLabel = '🟡 TRADE CAREFULLY — Monitor event reaction'
    verdictColor = 'yellow'
  } else {
    verdict = 'CLEAR'
    verdictLabel = '✓ CALENDAR CLEAR — No major events'
    verdictColor = 'green'
  }

  return { verdict, verdictLabel, verdictColor, reasons, avoidWindows, scoreAdjustment: scoreAdj, keyEvents }
}
