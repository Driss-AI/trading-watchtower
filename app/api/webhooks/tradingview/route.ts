import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendTelegramAlert, buildOrbAlert } from '@/lib/telegram'

// POST /api/webhooks/tradingview
// Receives ORB breakout alerts from TradingView Pine Script
// NEVER places trades — read-only processing only

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // ─── SECRET VALIDATION ──────────────────────────────────────────────────
    const configuredSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET
    if (configuredSecret && body.secret !== configuredSecret) {
      console.warn('[Webhook] Invalid secret attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ─── STORE RAW EVENT ────────────────────────────────────────────────────
    const event = await prisma.webhookEvent.create({
      data: {
        source: 'tradingview',
        payload: JSON.stringify(body),
        processed: false,
        alertSent: false,
      },
    })

    // ─── PROCESS ORB BREAKOUT ───────────────────────────────────────────────
    let alertSent = false

    if (body.event === 'ORB_BREAKOUT' && body.symbol && body.direction && body.price) {
      const settings = await prisma.settings.findFirst()

      if (settings?.telegramBotToken && settings?.telegramChatId) {
        const message = buildOrbAlert({
          symbol: body.symbol,
          direction: body.direction,
          price: body.price,
          orHigh: body.or_high ?? 0,
          orLow: body.or_low ?? 0,
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
