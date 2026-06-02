import { NextRequest, NextResponse } from 'next/server'
import { runBacktest } from '@/lib/backtest/runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // long replays — give the platform headroom

const MAX_RANGE_DAYS = 200 // guard against an accidental multi-year request

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

// POST /api/backtest/run
// body: { name, startDate, endDate, market?, config?, persist? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, startDate, endDate } = body
    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'startDate and endDate (YYYY-MM-DD) required' }, { status: 400 })
    }
    const span = daysBetween(startDate, endDate)
    if (!Number.isFinite(span) || span < 0) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }
    if (span > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: `Range too large (${span}d > ${MAX_RANGE_DAYS}d cap)` }, { status: 400 })
    }

    const result = await runBacktest({
      name: name ? String(name).slice(0, 120) : `Backtest ${startDate}..${endDate}`,
      startDate,
      endDate,
      config: {
        ...(body.market ? { market: String(body.market).toUpperCase() } : {}),
        ...(body.config && typeof body.config === 'object' ? body.config : {}),
      },
      persist: body.persist !== false,
    })

    return NextResponse.json({
      runId: result.runId,
      sessionsLoaded: result.sessionsLoaded,
      metrics: result.metrics,
      config: result.config,
    })
  } catch (err) {
    console.error('[Backtest run]', err)
    const msg = err instanceof Error ? err.message : 'Backtest failed'
    const code = msg.includes('not configured') || msg.includes('TopStepX') ? 503 : 500
    return NextResponse.json({ error: msg }, { status: code })
  }
}
