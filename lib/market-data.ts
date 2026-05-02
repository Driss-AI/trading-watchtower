// ─── MARKET DATA — AUTO-FETCH ─────────────────────────────────────────────────
// VIX + QQQ from Yahoo Finance (free, no API key)
// Economic calendar from Forex Factory JSON feed
// NQ overnight range from Yahoo Finance

export interface VIXData {
  level: number
  change: number
  changePct: number
  extreme: boolean        // true if >= 30
  elevated: boolean       // true if >= 20
  status: 'extreme' | 'elevated' | 'normal'
  label: string
}

export interface QQQData {
  price: number
  premarketPrice: number | null
  premarketChange: number | null
  premarketChangePct: number | null
  regularChange: number
  regularChangePct: number
  direction: 'bullish' | 'bearish' | 'neutral'
}

export interface NQData {
  price: number
  overnightHigh: number
  overnightLow: number
  previousClose: number
  change: number
  changePct: number
}

export interface NewsEvent {
  time: string        // "8:30am"
  title: string       // "CPI m/m"
  currency: string    // "USD"
  impact: 'high' | 'medium' | 'low'
  forecast?: string
  previous?: string
}

export interface MarketBriefing {
  vix: VIXData | null
  qqq: QQQData | null
  nq: NQData | null
  news: NewsEvent[]
  hasHighImpactNewsToday: boolean
  fetchedAt: string
  errors: string[]
}

// ─── YAHOO FINANCE FETCHER ────────────────────────────────────────────────────
async function yahooFetch(symbol: string): Promise<any> {
  // Use range=2d to get premarket data as well
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d&includePrePost=true`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradingWatchtower/2.0)',
      Accept: 'application/json',
    },
    next: { revalidate: 300 }, // cache 5 min
  })

  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status} for ${symbol}`)
  const data = await res.json()
  return data?.chart?.result?.[0]
}

// ─── VIX ─────────────────────────────────────────────────────────────────────
export async function fetchVIX(): Promise<VIXData> {
  const result = await yahooFetch('^VIX')
  const meta = result?.meta
  const level = parseFloat((meta?.regularMarketPrice ?? meta?.chartPreviousClose ?? 0).toFixed(2))
  const prevClose = meta?.chartPreviousClose ?? level
  const change = parseFloat((level - prevClose).toFixed(2))
  const changePct = parseFloat(((change / prevClose) * 100).toFixed(2))
  const extreme = level >= 30
  const elevated = level >= 20

  return {
    level,
    change,
    changePct,
    extreme,
    elevated,
    status: extreme ? 'extreme' : elevated ? 'elevated' : 'normal',
    label: extreme ? `⛔ EXTREME (${level})` : elevated ? `⚠️ ELEVATED (${level})` : `✓ Normal (${level})`,
  }
}

// ─── QQQ ─────────────────────────────────────────────────────────────────────
export async function fetchQQQ(): Promise<QQQData> {
  const result = await yahooFetch('QQQ')
  const meta = result?.meta

  const price = meta?.regularMarketPrice ?? 0
  const prevClose = meta?.chartPreviousClose ?? price
  const regularChange = parseFloat((price - prevClose).toFixed(2))
  const regularChangePct = parseFloat(((regularChange / prevClose) * 100).toFixed(2))

  // Premarket data
  const premarketPrice = meta?.preMarketPrice ?? null
  const premarketChange = premarketPrice != null ? parseFloat((premarketPrice - prevClose).toFixed(2)) : null
  const premarketChangePct = premarketChange != null ? parseFloat(((premarketChange / prevClose) * 100).toFixed(2)) : null

  // Use premarket if available for direction, otherwise use regular
  const effectiveChangePct = premarketChangePct ?? regularChangePct

  return {
    price,
    premarketPrice,
    premarketChange,
    premarketChangePct,
    regularChange,
    regularChangePct,
    direction:
      effectiveChangePct > 0.15 ? 'bullish' :
      effectiveChangePct < -0.15 ? 'bearish' :
      'neutral',
  }
}

// ─── NQ FUTURES ──────────────────────────────────────────────────────────────
export async function fetchNQ(): Promise<NQData> {
  const result = await yahooFetch('NQ=F')
  const meta = result?.meta

  const price = meta?.regularMarketPrice ?? 0
  const previousClose = meta?.chartPreviousClose ?? price
  const change = parseFloat((price - previousClose).toFixed(2))
  const changePct = parseFloat(((change / previousClose) * 100).toFixed(2))

  // Get day's high/low from quote summary
  const dayHigh = meta?.regularMarketDayHigh ?? price
  const dayLow  = meta?.regularMarketDayLow  ?? price

  return {
    price,
    overnightHigh: parseFloat(dayHigh.toFixed(2)),
    overnightLow: parseFloat(dayLow.toFixed(2)),
    previousClose: parseFloat(previousClose.toFixed(2)),
    change,
    changePct,
  }
}

// ─── ECONOMIC CALENDAR ───────────────────────────────────────────────────────
export async function fetchEconomicCalendar(): Promise<NewsEvent[]> {
  try {
    // Forex Factory public JSON calendar
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: { 'User-Agent': 'TradingWatchtower/2.0' },
      next: { revalidate: 3600 }, // cache 1 hour
    })

    if (!res.ok) throw new Error(`FF calendar HTTP ${res.status}`)

    const events: any[] = await res.json()

    // Today's date in YYYY-MM-DD
    const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

    return events
      .filter((e) => {
        const eventDate = e.date?.split('T')[0] ?? ''
        return eventDate === todayET && e.currency === 'USD'
      })
      .map((e) => ({
        time: e.time ?? 'All Day',
        title: e.title ?? '',
        currency: e.currency ?? 'USD',
        impact: (e.impact?.toLowerCase() === 'high' ? 'high' : e.impact?.toLowerCase() === 'medium' ? 'medium' : 'low') as 'high' | 'medium' | 'low',
        forecast: e.forecast ?? undefined,
        previous: e.previous ?? undefined,
      }))
      .filter((e) => e.title)
  } catch (err) {
    console.warn('[MarketData] Calendar fetch failed:', err)
    return []
  }
}

// ─── FULL BRIEFING ────────────────────────────────────────────────────────────
export async function fetchMarketBriefing(): Promise<MarketBriefing> {
  const errors: string[] = []
  let vix: VIXData | null = null
  let qqq: QQQData | null = null
  let nq: NQData | null = null
  let news: NewsEvent[] = []

  await Promise.allSettled([
    fetchVIX().then((d) => { vix = d }).catch((e) => errors.push(`VIX: ${e.message}`)),
    fetchQQQ().then((d) => { qqq = d }).catch((e) => errors.push(`QQQ: ${e.message}`)),
    fetchNQ().then((d)  => { nq  = d }).catch((e) => errors.push(`NQ: ${e.message}`)),
    fetchEconomicCalendar().then((d) => { news = d }).catch((e) => errors.push(`Calendar: ${e.message}`)),
  ])

  const hasHighImpactNewsToday = news.some((e) => e.impact === 'high')

  return {
    vix, qqq, nq, news,
    hasHighImpactNewsToday,
    fetchedAt: new Date().toISOString(),
    errors,
  }
}

// ─── MACRO SENTIMENT ─────────────────────────────────────────────────────────

export interface FearGreedData {
  score: number         // 0–100
  rating: string        // "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
  previousClose: number
  previousWeek: number
  previousMonth: number
  direction: 'rising' | 'falling' | 'flat'
  nqBias: 'bullish' | 'bearish' | 'neutral'  // fear = contrarian buy / greed = caution
  color: 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed'
}

export interface YieldData {
  symbol: string
  name: string
  current: number
  previousClose: number
  change: number
  changePct: number
  direction: 'rising' | 'falling' | 'flat'
  nqImpact: 'bullish' | 'bearish' | 'neutral'  // rising yield = bearish NQ
  label: string
}

export interface ESFuturesData {
  price: number
  previousClose: number
  change: number
  changePct: number
  premarketChangePct: number | null
  direction: 'bullish' | 'bearish' | 'neutral'
}

export interface MacroSentiment {
  fearGreed: FearGreedData | null
  us10y: YieldData | null
  dxy: YieldData | null
  es: ESFuturesData | null
  // Composite NQ bias derived from all signals
  nqBias: 'strong-bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong-bearish'
  nqBiasLabel: string
  bullishSignals: string[]
  bearishSignals: string[]
  // Direct feed into session scoring
  suggestUS10yAgainst: boolean   // true = US10Y is rising (bad for NQ)
  suggestDXYAgainst: boolean     // true = DXY is rising (bad for NQ)
  fetchedAt: string
  errors: string[]
}

// CNN Fear & Greed Index
export async function fetchFearAndGreed(): Promise<FearGreedData> {
  const res = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradingWatchtower/2.0)',
      'Referer': 'https://money.cnn.com/',
      Accept: 'application/json',
    },
    next: { revalidate: 600 }, // 10 min cache
  })

  if (!res.ok) throw new Error(`Fear & Greed HTTP ${res.status}`)
  const data = await res.json()
  const fg = data.fear_and_greed ?? data

  const score = parseFloat(fg.score ?? fg.current ?? 50)
  const prevClose = parseFloat(fg.previous_close ?? score)
  const prevWeek = parseFloat(fg.previous_1_week ?? score)
  const prevMonth = parseFloat(fg.previous_1_month ?? score)

  const color =
    score <= 25 ? 'extreme-fear' :
    score <= 45 ? 'fear' :
    score <= 55 ? 'neutral' :
    score <= 75 ? 'greed' :
    'extreme-greed'

  const rating =
    score <= 25 ? 'Extreme Fear' :
    score <= 45 ? 'Fear' :
    score <= 55 ? 'Neutral' :
    score <= 75 ? 'Greed' :
    'Extreme Greed'

  // For NQ ORB trading:
  // Extreme Fear (contrarian) can signal a bounce — slight bullish
  // Extreme Greed = market extended, caution
  // Neutral/mild = no strong bias
  const nqBias: FearGreedData['nqBias'] =
    score <= 20 ? 'bullish' :   // extreme fear = potential bounce
    score >= 80 ? 'bearish' :   // extreme greed = extended
    'neutral'

  return {
    score: parseFloat(score.toFixed(1)),
    rating,
    previousClose: parseFloat(prevClose.toFixed(1)),
    previousWeek: parseFloat(prevWeek.toFixed(1)),
    previousMonth: parseFloat(prevMonth.toFixed(1)),
    direction: score > prevClose + 1 ? 'rising' : score < prevClose - 1 ? 'falling' : 'flat',
    nqBias,
    color,
  }
}

// US 10Y Treasury Yield — inverse correlation with NQ
export async function fetchUS10Y(): Promise<YieldData> {
  const result = await yahooFetch('^TNX')
  const meta = result?.meta

  const current = parseFloat((meta?.regularMarketPrice ?? 0).toFixed(3))
  const prevClose = parseFloat((meta?.chartPreviousClose ?? current).toFixed(3))
  const change = parseFloat((current - prevClose).toFixed(3))
  const changePct = parseFloat(((change / prevClose) * 100).toFixed(2))

  const direction: YieldData['direction'] =
    changePct > 0.3 ? 'rising' : changePct < -0.3 ? 'falling' : 'flat'

  // Rising 10Y = bad for NQ (growth stocks de-rate on higher discount rate)
  const nqImpact: YieldData['nqImpact'] =
    direction === 'rising' ? 'bearish' :
    direction === 'falling' ? 'bullish' :
    'neutral'

  return {
    symbol: '^TNX',
    name: 'US 10Y Yield',
    current,
    previousClose: prevClose,
    change,
    changePct,
    direction,
    nqImpact,
    label: direction === 'rising'
      ? `↑ ${current}% — Bearish NQ pressure`
      : direction === 'falling'
      ? `↓ ${current}% — Bullish NQ support`
      : `→ ${current}% — Neutral`,
  }
}

// DXY Dollar Index — inverse correlation with NQ
export async function fetchDXY(): Promise<YieldData> {
  const result = await yahooFetch('DX=F')
  const meta = result?.meta

  const current = parseFloat((meta?.regularMarketPrice ?? 0).toFixed(2))
  const prevClose = parseFloat((meta?.chartPreviousClose ?? current).toFixed(2))
  const change = parseFloat((current - prevClose).toFixed(2))
  const changePct = parseFloat(((change / prevClose) * 100).toFixed(2))

  const direction: YieldData['direction'] =
    changePct > 0.2 ? 'rising' : changePct < -0.2 ? 'falling' : 'flat'

  // Rising DXY = bad for NQ (dollar strength pressures risk assets)
  const nqImpact: YieldData['nqImpact'] =
    direction === 'rising' ? 'bearish' :
    direction === 'falling' ? 'bullish' :
    'neutral'

  return {
    symbol: 'DX=F',
    name: 'US Dollar (DXY)',
    current,
    previousClose: prevClose,
    change,
    changePct,
    direction,
    nqImpact,
    label: direction === 'rising'
      ? `↑ ${current} — Bearish NQ pressure`
      : direction === 'falling'
      ? `↓ ${current} — Bullish NQ support`
      : `→ ${current} — Neutral`,
  }
}

// S&P 500 Futures (ES)
export async function fetchESFutures(): Promise<ESFuturesData> {
  const result = await yahooFetch('ES=F')
  const meta = result?.meta

  const price = meta?.regularMarketPrice ?? 0
  const prevClose = meta?.chartPreviousClose ?? price
  const change = parseFloat((price - prevClose).toFixed(2))
  const changePct = parseFloat(((change / prevClose) * 100).toFixed(2))
  const premarketPrice = meta?.preMarketPrice ?? null
  const premarketChangePct = premarketPrice
    ? parseFloat((((premarketPrice - prevClose) / prevClose) * 100).toFixed(2))
    : null

  const effectivePct = premarketChangePct ?? changePct

  return {
    price: parseFloat(price.toFixed(2)),
    previousClose: parseFloat(prevClose.toFixed(2)),
    change,
    changePct,
    premarketChangePct,
    direction: effectivePct > 0.15 ? 'bullish' : effectivePct < -0.15 ? 'bearish' : 'neutral',
  }
}

// Full Macro Sentiment Bundle
export async function fetchMacroSentiment(): Promise<MacroSentiment> {
  const errors: string[] = []
  let fearGreed: FearGreedData | null = null
  let us10y: YieldData | null = null
  let dxy: YieldData | null = null
  let es: ESFuturesData | null = null

  await Promise.allSettled([
    fetchFearAndGreed().then((d) => { fearGreed = d }).catch((e) => errors.push(`F&G: ${e.message}`)),
    fetchUS10Y().then((d) => { us10y = d }).catch((e) => errors.push(`US10Y: ${e.message}`)),
    fetchDXY().then((d) => { dxy = d }).catch((e) => errors.push(`DXY: ${e.message}`)),
    fetchESFutures().then((d) => { es = d }).catch((e) => errors.push(`ES: ${e.message}`)),
  ])

  // Build bullish/bearish signal list
  const bullishSignals: string[] = []
  const bearishSignals: string[] = []

  if (fearGreed) {
    if ((fearGreed as FearGreedData).nqBias === 'bullish') bullishSignals.push(`Fear & Greed: ${(fearGreed as FearGreedData).rating} (${(fearGreed as FearGreedData).score}) — contrarian buy signal`)
    if ((fearGreed as FearGreedData).nqBias === 'bearish') bearishSignals.push(`Fear & Greed: ${(fearGreed as FearGreedData).rating} (${(fearGreed as FearGreedData).score}) — market extended`)
  }
  if (us10y) {
    if ((us10y as YieldData).nqImpact === 'bearish') bearishSignals.push(`US10Y rising to ${(us10y as YieldData).current}% — discount rate pressure`)
    if ((us10y as YieldData).nqImpact === 'bullish') bullishSignals.push(`US10Y falling to ${(us10y as YieldData).current}% — supports growth stocks`)
  }
  if (dxy) {
    if ((dxy as YieldData).nqImpact === 'bearish') bearishSignals.push(`DXY rising to ${(dxy as YieldData).current} — dollar strength headwind`)
    if ((dxy as YieldData).nqImpact === 'bullish') bullishSignals.push(`DXY falling to ${(dxy as YieldData).current} — dollar weakness tailwind`)
  }
  if (es) {
    if ((es as ESFuturesData).direction === 'bullish') bullishSignals.push(`ES futures up ${(es as ESFuturesData).premarketChangePct ?? (es as ESFuturesData).changePct}%`)
    if ((es as ESFuturesData).direction === 'bearish') bearishSignals.push(`ES futures down ${Math.abs((es as ESFuturesData).premarketChangePct ?? (es as ESFuturesData).changePct)}%`)
  }

  // Composite bias
  const score = bullishSignals.length - bearishSignals.length
  const nqBias: MacroSentiment['nqBias'] =
    score >= 2 ? 'strong-bullish' :
    score === 1 ? 'bullish' :
    score === 0 ? 'neutral' :
    score === -1 ? 'bearish' :
    'strong-bearish'

  const nqBiasLabel =
    nqBias === 'strong-bullish' ? '🟢 Strong Bullish — Multiple tailwinds' :
    nqBias === 'bullish' ? '🟢 Bullish bias' :
    nqBias === 'neutral' ? '⬜ Neutral — Mixed signals' :
    nqBias === 'bearish' ? '🔴 Bearish bias' :
    '🔴 Strong Bearish — Multiple headwinds'

  return {
    fearGreed,
    us10y,
    dxy,
    es,
    nqBias,
    nqBiasLabel,
    bullishSignals,
    bearishSignals,
    suggestUS10yAgainst: (us10y as YieldData | null)?.nqImpact === 'bearish',
    suggestDXYAgainst:   (dxy  as YieldData | null)?.nqImpact === 'bearish',
    fetchedAt: new Date().toISOString(),
    errors,
  }
}
