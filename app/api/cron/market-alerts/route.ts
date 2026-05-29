export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'

const MESSAGES: Record<string, string> = {
  warning15: [
    '⏰ *Trading Watchtower*',
    '',
    'Market opens in *15 minutes*',
    '🕐 9:30 AM ET  |  5:30 PM Dubai',
    '',
    'Review your OR plan and bias 📋',
  ].join('\n'),

  warning5: [
    '⚠️ *Trading Watchtower*',
    '',
    'Market opens in *5 minutes*',
    '',
    'Final checks:',
    '• NQ pre-market direction',
    '• VIX level',
    '• QQQ bias',
    '• Economic events today',
  ].join('\n'),

  open: [
    '🟢 *Trading Watchtower*',
    '',
    '*MARKET OPEN*',
    'Opening Range is now building',
    '⏱ 9:30 → 10:00 AM ET',
    '',
    'Watch and wait — do NOT trade yet',
  ].join('\n'),

  trade: [
    '⚡ *Trading Watchtower*',
    '',
    '*TRADE WINDOW OPEN*',
    'OR is complete — breakout alerts active',
    '⏱ 10:00 → 11:00 AM ET  |  6:00 → 7:00 PM Dubai',
    '',
    'Max 2 trades · $1K daily limit · 2:1 R:R minimum',
  ].join('\n'),

  close: [
    '🔴 *Trading Watchtower*',
    '',
    '*SESSION CLOSED*',
    '11:00 AM ET  |  7:00 PM Dubai',
    '',
    'Trade window ended. Log your trades 📊',
  ].join('\n'),
}

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
  if (!type || !MESSAGES[type]) {
    return NextResponse.json({ error: `Invalid type. Valid: ${Object.keys(MESSAGES).join(', ')}` }, { status: 400 })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set' }, { status: 503 })
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: MESSAGES[type],
        parse_mode: 'Markdown',
      }),
    })
    const data = await res.json()
    if (!data.ok) {
      return NextResponse.json({ error: data.description }, { status: 500 })
    }
    return NextResponse.json({ ok: true, type, sent: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
