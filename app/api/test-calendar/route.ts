import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

export async function GET() {
  const results: Record<string, string> = {}
  
  const sources = [
    ['ForexFactory', 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'],
    ['ForexFactory-next', 'https://nfs.faireconomy.media/ff_calendar_nextweek.json'],
    ['TradingEconomics', 'https://api.tradingeconomics.com/calendar'],
    ['Investing.com', 'https://api.investing.com/api/financialdata/economic-calendar'],
  ]

  await Promise.all(sources.map(async ([name, url]) => {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        signal: AbortSignal.timeout(5000),
      })
      // Try to read a snippet of the data
      const text = await r.text()
      results[name] = `${r.status} — ${text.slice(0, 80)}`
    } catch (e: any) {
      results[name] = `ERROR: ${e.message}`
    }
  }))

  return NextResponse.json(results)
}
