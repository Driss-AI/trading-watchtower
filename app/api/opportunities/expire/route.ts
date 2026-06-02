export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'

// POST /api/opportunities/expire — auto-expiry writeback.
// Marks executable (finalDecision=take) opportunities the user never logged as
// EXPIRED once their validity window has elapsed, so the scoreboard's
// execution-quality stats aren't skewed by perpetual NOT_TAKEN rows.
//
// Skip-decision rows are left alone: there was nothing to execute, so
// NOT_TAKEN is the correct terminal state for them.
//
// Auth: x-cron-secret header (same pattern as the market-alerts cron) so a
// Railway/GitHub-Actions schedule can drive it. Rate-limited per IP.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`cron:${ip}`, 10, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const secret = req.headers.get('x-cron-secret')
  const expected = process.env.CRON_SECRET
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await prisma.signalOpportunity.updateMany({
      where: {
        finalDecision: 'take',
        manualExecutionStatus: 'NOT_TAKEN',
        signalExpiresAt: { lt: new Date() },
        source: { in: ['paper', 'live-signal'] },
      },
      data: {
        manualExecutionStatus: 'EXPIRED',
        expiredReason: 'Signal validity window elapsed',
      },
    })
    return NextResponse.json({ ok: true, expired: result.count })
  } catch (err) {
    console.error('[expire] failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
