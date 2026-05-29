export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { sendMarketAlert, ALERT_TYPES, type AlertType } from '@/lib/market-alerts'

// NOTE: Alerts are now sent automatically by the in-app scheduler in
// lib/market-alerts.ts (DST-aware, follows New York time). This endpoint is
// kept for manual/external triggering and shares the same message + send logic.
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`cron:${ip}`, 10, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const secret = req.headers.get('x-cron-secret')
  const expected = process.env.CRON_SECRET
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const type = req.nextUrl.searchParams.get('type')
  if (!type || !ALERT_TYPES.includes(type as AlertType)) {
    return NextResponse.json({ error: `Invalid type. Valid: ${ALERT_TYPES.join(', ')}` }, { status: 400 })
  }

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set' }, { status: 503 })
  }

  try {
    const sent = await sendMarketAlert(type as AlertType)
    if (!sent) {
      return NextResponse.json({ error: 'Telegram send failed' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, type, sent })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
