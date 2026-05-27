import { NextResponse } from 'next/server'
import { sendTelegramAlert } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? ''
  const chatId = process.env.TELEGRAM_CHAT_ID ?? ''

  if (!token || !chatId) {
    return NextResponse.json({
      ok: false,
      error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set',
      hasToken: !!token,
      hasChatId: !!chatId,
    })
  }

  const ok = await sendTelegramAlert(
    { botToken: token, chatId },
    '✅ <b>TELEGRAM TEST</b>\nTrading Watchtower is connected!\nYou will receive alerts during market hours (9:30–11:30 AM ET).',
  )

  return NextResponse.json({ ok, token: token.slice(0, 6) + '...', chatId })
}
