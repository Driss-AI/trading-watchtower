// GET /api/topstepx/bars?symbol=MNQ&period=orwindow
// GET /api/topstepx/bars?symbol=MNQ&from=ISO&to=ISO&unit=2&unitNumber=5
//
// Fetches OHLCV bars from TopStepX History API.
// period=orwindow  → auto-computes today 9:25 AM ET to now (covers OR + first trade bars)

import { NextRequest, NextResponse } from 'next/server'
import { getTopstepXToken, getActiveMNQContractId, getActiveNQContractId } from '@/lib/topstepx'

export const dynamic = 'force-dynamic'

// Returns an ISO string for a given hour:minute in America/New_York, today.
function etToday(hour: number, minute: number): string {
  const now = new Date()
  // Get the current ET civil time so we can compute the UTC offset
  const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const offsetMs = now.getTime() - nowET.getTime()
  // Get today's date parts in ET
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const p: Record<string, string> = {}
  for (const { type, value } of parts) p[type] = value
  // Build a Date at that hour:minute in ET local time, then convert to UTC
  const targetET = new Date(
    parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day),
    hour, minute, 0, 0
  )
  return new Date(targetET.getTime() + offsetMs).toISOString()
}

export async function GET(req: NextRequest) {
  if (!process.env.TOPSTEPX_USERNAME || !process.env.TOPSTEPX_API_KEY) {
    return NextResponse.json({ error: 'TopStepX not configured' }, { status: 503 })
  }

  const { searchParams } = req.nextUrl
  const symbol     = (searchParams.get('symbol') ?? 'MNQ').toUpperCase()
  const period     = searchParams.get('period')   // 'orwindow' shorthand
  const unit       = parseInt(searchParams.get('unit')       ?? '2')  // 2 = Minute
  const unitNumber = parseInt(searchParams.get('unitNumber') ?? '5')  // 5-min bars

  let from: string
  let to: string

  if (period === 'orwindow') {
    // 9:25 AM ET → now: captures last OR bar + first 2 trade-window bars
    from = etToday(9, 25)
    to   = new Date().toISOString()
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

    // TopStepX ProjectX Gateway — History/retrieveBars
    const res = await fetch('https://gateway.topstepx.com/api/History/retrieveBars', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        contractId,
        live: true,
        startTime: from,
        endTime: to,
        unit,
        unitNumber,
        limit: 50,
        includePartialBar: true,
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
    return NextResponse.json({ bars: data.bars ?? [], contractId, from, to })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[TopStepX bars]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
