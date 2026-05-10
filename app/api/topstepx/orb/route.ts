import { NextRequest, NextResponse } from 'next/server'
import { calculateOpeningRange } from '@/lib/topstepx'
import { prisma } from '@/lib/prisma'
import { sendTelegramAlert, buildOrbAlert } from '@/lib/telegram'

// GET /api/topstepx/orb?symbol=NQ&live=true
// Calculates OR from TopstepX bar data and detects breakouts
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const symbol = (searchParams.get('symbol') ?? 'NQ') as 'NQ' | 'MNQ'
    const live = searchParams.get('live') !== 'false'

    const orb = await calculateOpeningRange(symbol, live)

    // If breakout detected, fire Telegram alert + store session OR data
    if (orb.breakoutDirection !== 'NONE') {
      const settings = await prisma.settings.findFirst()
      const today = new Date().toISOString().split('T')[0]

      // Get today's session score if available
      const session = await prisma.session.findFirst({ where: { date: today } })

      if (settings?.telegramBotToken && settings?.telegramChatId) {
        const message = buildOrbAlert({
          symbol,
          direction: orb.breakoutDirection,
          price: orb.currentPrice,
          orHigh: orb.orHigh,
          orLow: orb.orLow,
          score: session?.score,
          decision: session?.decision,
        })

        await sendTelegramAlert(
          { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
          message
        ).catch((e) => console.error('[ORB] Telegram alert failed:', e))
      }

      // Auto-update session with OR levels
      if (session) {
        await prisma.session.update({
          where: { date: today },
          data: {
            orHigh: orb.orHigh,
            orLow: orb.orLow,
            orSize: orb.orSize,
          },
        }).catch(() => {})
      }
    }

    return NextResponse.json({ orb })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    // Log the full error server-side for debugging
    console.error('[ORB] Error:', msg)

    // Detect "market closed / no data" errors and return 200 with null ORB
    // These are expected during weekends, holidays, and pre-market
    const isNoData =
      msg.includes('retrieveBars') ||
      msg.includes('No bars') ||
      msg.includes('error (1)') ||
      msg.includes('null') ||
      msg.includes('not configured')

    if (isNoData) {
      return NextResponse.json({
        orb: null,
        reason: 'market_closed',
        message: 'ORB unavailable — market may be closed or pre-open',
      })
    }

    // Unexpected error — return 500 but sanitize the message
    return NextResponse.json({
      error: 'ORB calculation failed — check server logs',
      orb: null,
    }, { status: 500 })
  }
}
