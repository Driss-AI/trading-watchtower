import { NextResponse } from 'next/server'
import { fetchMarketBriefing } from '@/lib/market-data'

// GET /api/market-data
// Returns VIX, QQQ premarket, NQ overnight, today's economic events
// No API key required — uses Yahoo Finance + Forex Factory (free, public)
export async function GET() {
  try {
    const briefing = await fetchMarketBriefing()
    return NextResponse.json({ briefing })
  } catch (err) {
    console.error('[MarketData API]', err)
    return NextResponse.json({ error: 'Failed to fetch market data', briefing: null }, { status: 500 })
  }
}
