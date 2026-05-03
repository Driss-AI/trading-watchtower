import { NextResponse } from 'next/server'
import { fetchMarketBriefing, fetchWeekCalendar, getMarketStatus } from '@/lib/market-data'

// GET /api/market-data — VIX, QQQ, NQ, today's news + full week calendar
export async function GET() {
  try {
    const [briefing, weekCalendar] = await Promise.all([
      fetchMarketBriefing(),
      fetchWeekCalendar(),
    ])
    const marketStatus = getMarketStatus()
    return NextResponse.json({ briefing, weekCalendar, marketStatus })
  } catch (err) {
    console.error('[MarketData API]', err)
    return NextResponse.json({ error: String(err), briefing: null, weekCalendar: [], marketStatus: null }, { status: 500 })
  }
}
