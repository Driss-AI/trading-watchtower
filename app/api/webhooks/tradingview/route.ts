export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendTelegramAlert, buildOrbAlert } from '@/lib/telegram'
import { rateLimit } from '@/lib/rate-limit'
import { tradingViewWebhookSchema } from '@/lib/webhook-schema'

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
    if (!rateLimit(`webhook:${ip}`, 30, 60_000).allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = await req.json()

    const configuredSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET
    if (!configuredSecret || body.secret !== configuredSecret) {
      console.warn('[Webhook] Invalid secret attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = tradingViewWebhookSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.issues }, { status: 400 })
    }
    const payload = parsed.data

    const event = await prisma.webhookEvent.create({
      data: {
        source: 'tradingview',
        payload: JSON.stringify(payload),
        processed: false,
        alertSent: false,
      },
    })

    let alertSent = false

    if (payload.event === 'ORB_BREAKOUT' && payload.symbol && payload.direction && payload.price) {
      const settings = await prisma.settings.findFirst()

      if (settings?.telegramBotToken && settings?.telegramChatId) {
        const message = buildOrbAlert({
          symbol: payload.symbol,
          direction: payload.direction,
          price: payload.price,
          orHigh: payload.or_high ?? 0,
          orLow: payload.or_low ?? 0,
        })

        alertSent = await sendTelegramAlert(
          {
            botToken: settings.telegramBotToken,
            chatId: settings.telegramChatId,
          },
          message
        )
      }

      // Mark event as processed
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processed: true, alertSent },
      })
    }

    return NextResponse.json({
      received: true,
      eventId: event.id,
      alertSent,
    })
  } catch (err) {
    console.error('[Webhook] Error:', err)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

// TradingView example payload:
// {
//   "secret": "YOUR_WEBHOOK_SECRET",
//   "symbol": "MNQ",
//   "event": "ORB_BREAKOUT",
//   "direction": "LONG",
//   "price": 18450.25,
//   "or_high": 18440.00,
//   "or_low": 18390.00,
//   "timestamp": "2026-01-15T10:05:00-04:00"
// }
