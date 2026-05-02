import { NextResponse } from 'next/server'
import { fetchMacroSentiment } from '@/lib/market-data'

// GET /api/macro — Full macro sentiment: Fear&Greed, US10Y, DXY, ES futures, NQ bias
export async function GET() {
  try {
    const macro = await fetchMacroSentiment()
    return NextResponse.json({ macro })
  } catch (err) {
    return NextResponse.json({ error: String(err), macro: null }, { status: 500 })
  }
}
