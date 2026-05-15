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
  source?: 'topstep' | 'yahoo'
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
  marketStatus: ReturnType<typeof getMarketStatus>
  fetchedAt: string
  errors: string[]
}

// ─── TIMEZONE HELPER ──────────────────────────────────────────────────────────
// Returns today's date string in ET as "YYYY-MM-DD" WITHOUT the double-
// conversion bug.  The old code did:
//   new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
//     .toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
// which subtracts the UTC offset TWICE, rolling the date back a day during
// late-night ET hours.  The fix is to call toLocaleDateString on the real Date
// object directly.

function getTodayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

function getTomorrowET(): string {
  const now = new Date()
  // Add 24h to current time, then format in ET
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  return tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

// ─── YAHOO FINANCE FETCHER ────────────────────────────────────────────────────
async function yahooFetch(symbol: string): Promise<any> {
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

  const premarketPrice = meta?.preMarketPrice ?? null
  const premarketChange = premarketPrice != null ? parseFloat((premarketPrice - prevClose).toFixed(2)) : null
  const premarketChangePct = premarketChange != null ? parseFloat(((premarketChange / prevClose) * 100).toFixed(2)) : null

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
  // Strategy 1: Topstep API (real-time, exchange accurate)
  try {
    const { getActiveMNQContractId, getMinuteBars } = await import('./topstepx')
    const contractId = await getActiveMNQContractId()
    const now = new Date()
    const start = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    const bars = await getMinuteBars(contractId, start, now, true, 150)
    if (bars.length > 0) {
      const lastBar = bars[bars.length - 1]
      const price = lastBar.c
      const sessionHigh = Math.max(...bars.map(b => b.h))
      const sessionLow  = Math.min(...bars.map(b => b.l))
      const previousClose = bars[0].o
      const change = parseFloat((price - previousClose).toFixed(2))
      const changePct = parseFloat(((change / previousClose) * 100).toFixed(2))
      console.info(`[NQ] Topstep: ${price} | H:${sessionHigh} L:${sessionLow} | bars:${bars.length}`)
      return { price, overnightHigh: parseFloat(sessionHigh.toFixed(2)), overnightLow: parseFloat(sessionLow.toFixed(2)), previousClose: parseFloat(previousClose.toFixed(2)), change, changePct, source: 'topstep' }
    }
  } catch (err) {
    console.warn('[NQ] Topstep fetch failed, falling back to Yahoo:', err)
  }
  // Strategy 2: Yahoo Finance fallback
  const result = await yahooFetch('NQ=F')
  const meta = result?.meta
  const price = meta?.regularMarketPrice ?? 0
  const previousClose = meta?.chartPreviousClose ?? price
  const change = parseFloat((price - previousClose).toFixed(2))
  const changePct = parseFloat(((change / previousClose) * 100).toFixed(2))
  const dayHigh = meta?.regularMarketDayHigh ?? price
  const dayLow  = meta?.regularMarketDayLow  ?? price
  return { price, overnightHigh: parseFloat(dayHigh.toFixed(2)), overnightLow: parseFloat(dayLow.toFixed(2)), previousClose: parseFloat(previousClose.toFixed(2)), change, changePct, source: 'yahoo' }
}

// ─── ECONOMIC CALENDAR ───────────────────────────────────────────────────────

export async function fetchEconomicCalendar(todayOnly = false): Promise<NewsEvent[]> {
  const allDays = await fetchWeekCalendar()
  const ms = getMarketStatus()
  
  // On weekends, return Monday's events as "today's" events for the briefing
  if (ms.isWeekend) {
    const monday = allDays.find(d => {
      const dt = new Date(d.date + 'T12:00:00Z')
      return dt.getDay() === 1
    })
    return monday?.events ?? []
  }

  const todayET = getTodayET()
  const today = allDays.find(d => d.date === todayET)
  return today?.events ?? []
}

export async function fetchWeekCalendar(): Promise<CalendarDay[]> {
  // Strategy 1: Direct ForexFactory
  try {
    const [thisWeek, nextWeek] = await Promise.allSettled([
      _fetchFromProxy('https://nfs.faireconomy.media/ff_calendar', 'this'),
      _fetchFromProxy('https://nfs.faireconomy.media/ff_calendar', 'next'),
    ])
    const days: CalendarDay[] = []
    if (thisWeek.status === 'fulfilled') days.push(...thisWeek.value)
    if (nextWeek.status === 'fulfilled') days.push(...nextWeek.value)
    const combined = mergeDays(days, [])
    if (combined.length > 0) { console.info('[Calendar] Direct FF: ' + combined.length + ' days'); return combined }
  } catch (err) { console.warn('[Calendar] Direct FF failed:', err) }
  // Strategy 2: CF proxy fallback
  const proxyURL = process.env.FF_CALENDAR_PROXY_URL
  if (proxyURL) {
    try {
      const [thisWeek, nextWeek] = await Promise.allSettled([
        _fetchFromProxy(proxyURL, 'this'),
        _fetchFromProxy(proxyURL, 'next'),
      ])
      const days: CalendarDay[] = []
      if (thisWeek.status === 'fulfilled') days.push(...thisWeek.value)
      if (nextWeek.status === 'fulfilled') days.push(...nextWeek.value)
      const combined = mergeDays(days, [])
      if (combined.length > 0) return combined
    } catch (err) { console.warn('[Calendar] Proxy failed, using computed:', err) }
  }
  const { computeWeekCalendar } = await import('./calendar-schedule')
  return computeWeekCalendar()
}

async function _fetchFromProxy(proxyURL: string, week: 'this' | 'next'): Promise<CalendarDay[]> {
  const fullURL = proxyURL.endsWith('/ff_calendar') ? `${proxyURL}_${week}week.json` : `${proxyURL}?week=${week}`
  const res = await fetch(fullURL, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://www.forexfactory.com/' },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Fetch returned ${res.status} for ${fullURL}`)
  const events: any[] = await res.json()

  // ── FIX: use getTodayET / getTomorrowET to avoid double-conversion ──
  const todayET    = getTodayET()
  const tomorrowET = getTomorrowET()

  const byDate = new Map<string, NewsEvent[]>()
  for (const e of events) {
    if (e.currency !== 'USD') continue
    const date = e.date?.split('T')[0]
    if (!date) continue
    const dt = new Date(date + 'T12:00:00Z')
    if (dt.getDay() === 0 || dt.getDay() === 6) continue
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date)!.push({
      time: e.time ?? 'All Day',
      title: e.title ?? '',
      currency: 'USD',
      impact: (e.impact?.toLowerCase() === 'high' ? 'high'
             : e.impact?.toLowerCase() === 'medium' ? 'medium' : 'low') as 'high' | 'medium' | 'low',
      forecast: e.forecast ?? undefined,
      previous: e.previous ?? undefined,
    })
  }

  const days: CalendarDay[] = []
  for (const [date, dayEvents] of Array.from(byDate.entries()).sort()) {
    const dt = new Date(date + 'T12:00:00Z')
    const dateLabel = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
    days.push({
      date,
      dateLabel,
      isToday: date === todayET,
      isTomorrow: date === tomorrowET,
      events: dayEvents.filter(e => e.title),
      hasHighImpact: dayEvents.some(e => e.impact === 'high'),
    })
  }
  return days
}

function mergeDays(a: CalendarDay[], b: CalendarDay[]): CalendarDay[] {
  const map = new Map<string, CalendarDay>()
  for (const d of [...a, ...b]) map.set(d.date, d)
  return Array.from(map.values()).sort((x, y) => x.date.localeCompare(y.date))
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
  const marketStatus = getMarketStatus()

  return {
    vix, qqq, nq, news,
    hasHighImpactNewsToday,
    marketStatus,
    fetchedAt: new Date().toISOString(),
    errors,
  }
}

// ─── MACRO SENTIMENT ─────────────────────────────────────────────────────────

export interface FearGreedData {
  score: number
  rating: string
  previousClose: number
  previousWeek: number
  previousMonth: number
  direction: 'rising' | 'falling' | 'flat'
  nqBias: 'bullish' | 'bearish' | 'neutral'
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
  nqImpact: 'bullish' | 'bearish' | 'neutral'
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
  nqBias: 'strong-bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong-bearish'
  nqBiasLabel: string
  bullishSignals: string[]
  bearishSignals: string[]
  suggestUS10yAgainst: boolean
  suggestDXYAgainst: boolean
  marketStatus: ReturnType<typeof getMarketStatus>
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
    next: { revalidate: 600 },
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

  const nqBias: FearGreedData['nqBias'] =
    score <= 20 ? 'bullish' :
    score >= 80 ? 'bearish' :
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

// US 10Y Treasury Yield
export async function fetchUS10Y(): Promise<YieldData> {
  const result = await yahooFetch('^TNX')
  const meta = result?.meta

  const current = parseFloat((meta?.regularMarketPrice ?? 0).toFixed(3))
  const prevClose = parseFloat((meta?.chartPreviousClose ?? current).toFixed(3))
  const change = parseFloat((current - prevClose).toFixed(3))
  const changePct = parseFloat(((change / prevClose) * 100).toFixed(2))

  const direction: YieldData['direction'] =
    changePct > 0.3 ? 'rising' : changePct < -0.3 ? 'falling' : 'flat'

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

// DXY Dollar Index
export async function fetchDXY(): Promise<YieldData> {
  let result: any = null
  for (const sym of ['DX=F', 'DX-Y.NYB', 'UUP']) {
    try { result = await yahooFetch(sym); if (result?.meta?.regularMarketPrice) break } catch {}
  }
  const meta = result?.meta

  const current = parseFloat((meta?.regularMarketPrice ?? 0).toFixed(2))
  const prevClose = parseFloat((meta?.chartPreviousClose ?? current).toFixed(2))
  const change = parseFloat((current - prevClose).toFixed(2))
  const changePct = parseFloat(((change / prevClose) * 100).toFixed(2))

  const direction: YieldData['direction'] =
    changePct > 0.2 ? 'rising' : changePct < -0.2 ? 'falling' : 'flat'

  const nqImpact: YieldData['nqImpact'] =
    direction === 'rising' ? 'bearish' :
    direction === 'falling' ? 'bullish' :
    'neutral'

  return {
    symbol: 'DXY',
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


import type { CalendarDay } from './calendar-schedule'

// ─── CALENDAR ─────────────────────────────────────────────────────────────────
export { computeWeekCalendar } from './calendar-schedule'
export type { CalendarDay } from './calendar-schedule'

// ─── MARKET SCHEDULE HELPERS ──────────────────────────────────────────────────

export function getMarketStatus(): {
  isWeekend: boolean
  isPreMarket: boolean
  isMarketHours: boolean
  isAfterHours: boolean
  nextSessionLabel: string
  contextLabel: string
} {
  const now = new Date()
  // Use Intl to get ET hours/minutes WITHOUT double-conversion
  const etParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false,
    weekday: 'short',
  }).formatToParts(now)

  const hour = parseInt(etParts.find(p => p.type === 'hour')?.value ?? '0')
  const min  = parseInt(etParts.find(p => p.type === 'minute')?.value ?? '0')
  const weekdayStr = etParts.find(p => p.type === 'weekday')?.value ?? ''
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const day = dayMap[weekdayStr] ?? new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay()

  const timeDecimal = hour + min / 60

  const isWeekend = day === 0 || day === 6
  const isPreMarket  = !isWeekend && timeDecimal >= 4 && timeDecimal < 9.5
  const isMarketHours = !isWeekend && timeDecimal >= 9.5 && timeDecimal < 16
  const isAfterHours  = !isWeekend && (timeDecimal >= 16 || timeDecimal < 4)

  let nextSessionLabel = ''
  let contextLabel = ''

  if (isWeekend) {
    const daysUntilMon = day === 6 ? 2 : 1
    nextSessionLabel = `Monday (opens in ${daysUntilMon === 1 ? 'tomorrow' : '2 days'})`
    contextLabel = "Weekend — Next Week's"
  } else if (isAfterHours || (day === 5 && timeDecimal >= 16)) {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const tomorrowDay = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(tomorrow).slice(0, 1))
    const isFriday = day === 5
    nextSessionLabel = isFriday ? 'Monday' : 'Tomorrow'
    contextLabel = "Next Session's"
  } else if (isPreMarket) {
    contextLabel = "Today's Pre-Market"
    nextSessionLabel = 'Today (opens 9:30 AM ET)'
  } else {
    contextLabel = "Live"
    nextSessionLabel = 'Now'
  }

  return { isWeekend, isPreMarket, isMarketHours, isAfterHours, nextSessionLabel, contextLabel }
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

  const marketStatus = getMarketStatus()

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
    marketStatus,
    fetchedAt: new Date().toISOString(),
    errors,
  }
}
