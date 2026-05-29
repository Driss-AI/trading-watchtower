// GET /api/topstepx/bars?symbol=MNQ&period=orwindow
// GET /api/topstepx/bars?symbol=MNQ&from=ISO&to=ISO&unit=2&unitNumber=5
//
// Fetches OHLCV bars from TopStepX History API.
// period=orwindow → auto-computes today 9:25 AM ET to 11:30 AM ET
// Uses live=false (sim subscription) for eval/combine accounts.

import { NextRequest, NextResponse } from 'next/server'
import { getTopstepXToken, getActiveMNQContractId, getActiveNQContractId } from '@/lib/topstepx'

export const dynamic = 'force-dynamic'

// Use the same REST base as the rest of the app (api.topstepx.com), overridable
// via env — avoids pointing at a different host than lib/topstepx.ts.
const BASE_URL = process.env.TOPSTEPX_BASE_URL ?? 'https://api.topstepx.com'

// Returns an ISO string for a given hour:minute in America/New_York, today.
function etToday(hour: number, minute: number): string {
  const now   = new Date()
  const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const offsetMs = now.getTime() - nowET.getTime()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const p: Record<string, string> = {}
  for (const { type, value } of parts) p[type] = value
  const targetET = new Date(
    parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day),
    hour, minute, 0, 0
  )
  return new Date(targetET.getTime() + offsetMs).toISOString()
}

// Normalise bar fields — TopStepX returns {t,o,h,l,c,v} but guard against
// alternative shapes some ProjectX white-labels use.
function normaliseBar(raw: any): { t: string; o: number; h: number; l: number; c: number; v: number } | null {
  if (!raw) return null
  const t = raw.t ?? raw.timestamp ?? raw.time ?? raw.dateTime
  const o = raw.o ?? raw.open
  const h = raw.h ?? raw.high
  const l = raw.l ?? raw.low
  const c = raw.c ?? raw.close
  const v = raw.v ?? raw.volume ?? 0
  if (!t || o == null || h == null || l == null || c == null) return null
  return { t: String(t), o: Number(o), h: Number(h), l: Number(l), c: Number(c), v: Number(v) }
}

export async function GET(req: NextRequest) {
  if (!process.env.TOPSTEPX_USERNAME || !process.env.TOPSTEPX_API_KEY) {
    return NextResponse.json({ error: 'TopStepX not configured' }, { status: 503 })
  }

  const { searchParams } = req.nextUrl
  const symbol     = (searchParams.get('symbol') ?? 'MNQ').toUpperCase()
  const period     = searchParams.get('period')
  const unit       = parseInt(searchParams.get('unit')       ?? '2')  // 2 = Minute
  const unitNumber = parseInt(searchParams.get('unitNumber') ?? '5')  // 5-min bars

  let from: string
  let to: string

  if (period === 'orwindow') {
    // 9:25 AM → 11:30 AM ET: covers full OR + full trade window with buffer
    // Fixed end time avoids sending afternoon bars that have nothing to do with ORB
    from = etToday(9, 25)
    to   = etToday(11, 30)
  } else {
    from = searchParams.get('from') ?? ''
    to   = searchParams.get('to')   ?? ''
    if (!from || !to) {
      return NextResponse.json(
        { error: 'Provide period=orwindow or explicit from= and to= params' },
        { status: 400 }
      )
    }
  }

  try {
    const token      = await getTopstepXToken()
    const contractId = symbol === 'NQ'
      ? await getActiveNQContractId()
      : await getActiveMNQContractId()

    // live: false → uses sim/combine data subscription (correct for TopStep eval accounts)
    const res = await fetch(`${BASE_URL}/api/History/retrieveBars`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        contractId,
        live: false,
        startTime: from,
        endTime: to,
        unit,
        unitNumber,
        limit: 50,
        includePartialBar: false,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        { error: `TopStepX bars error (${res.status}): ${text}` },
        { status: res.status }
      )
    }

    const data = await res.json()
    const rawBars: any[] = data.bars ?? data.Bars ?? data.data ?? []
    const bars = rawBars.map(normaliseBar).filter(Boolean)

    return NextResponse.json({ bars, contractId, from, to, count: bars.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[TopStepX bars]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
