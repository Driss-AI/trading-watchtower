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
        impact: e.impact?.toLowerCase() === 'high' ? 'high' : e.impact?.toLowerCase() === 'medium' ? 'medium' : 'low',
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
