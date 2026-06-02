// GET /api/topstepx/bars-probe?date=2026-01-15
// DIAGNOSTIC: for a given NY date, probe several candidate quarterly contracts
// to learn which one actually serves bars on that day. Used to validate the
// historical contract-rollover resolver for the backtest. Auth-gated.

import { NextRequest, NextResponse } from 'next/server'
import { getMinuteBars } from '@/lib/topstepx'

export const dynamic = 'force-dynamic'

// Candidate MNQ quarterly contracts spanning recent history.
const CANDIDATES = [
  'CON.F.US.MNQ.Z25', // Dec 2025
  'CON.F.US.MNQ.H26', // Mar 2026
  'CON.F.US.MNQ.M26', // Jun 2026
]

export async function GET(req: NextRequest) {
  if (!process.env.TOPSTEPX_USERNAME || !process.env.TOPSTEPX_API_KEY) {
    return NextResponse.json({ error: 'TopStepX not configured' }, { status: 503 })
  }
  const date = req.nextUrl.searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'date=YYYY-MM-DD required' }, { status: 400 })

  // 14:30–15:30 UTC ≈ mid-morning ET regardless of DST — just need a liquid hour.
  const from = new Date(`${date}T14:30:00.000Z`)
  const to = new Date(`${date}T15:30:00.000Z`)

  const results: Array<{ contractId: string; bars: number; firstT: string | null; error?: string }> = []
  for (const cid of CANDIDATES) {
    try {
      const bars = await getMinuteBars(cid, from, to, false, 80)
      results.push({ contractId: cid, bars: bars.length, firstT: bars[0]?.t ?? null })
    } catch (err) {
      results.push({ contractId: cid, bars: 0, firstT: null, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ date, results })
}
