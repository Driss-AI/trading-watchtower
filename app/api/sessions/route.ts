export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calculateScore } from '@/lib/scoring'

// GET /api/sessions — get today's session (or create it)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0]

    const session = await prisma.session.findFirst({ where: { date } })

    if (!session) {
      return NextResponse.json({ session: null })
    }

    return NextResponse.json({ session })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 })
  }
}

// POST /api/sessions — create or update today's session
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const date = body.date ?? new Date().toISOString().split('T')[0]

    // Load settings for scoring context
    const settings = await prisma.settings.findFirst()
    const maxTradesPerDay = settings?.maxTradesPerDay ?? 2
    const maxLosingTradesPerDay = settings?.maxLosingTradesPerDay ?? 2
    const dailyLossLimit = settings?.dailyLossLimit ?? 2000

    // Count today's trades if session exists
    const existingSession = await prisma.session.findFirst({ where: { date } })
    const tradesToday = existingSession?.tradesCount ?? 0
    const lossesToday = existingSession?.losesCount ?? 0
    const dailyPnl = existingSession?.dailyPnl ?? 0

    // Calculate score
    const scoreInput = {
      hasHighImpactNews: body.hasHighImpactNews ?? false,
      orSize: body.orSize ?? 0,
      directionBias: body.directionBias ?? 'neutral',
      tradeDirection: body.tradeDirection ?? 'LONG',
      vixExtreme: body.vixExtreme ?? false,
      qqpAligned: body.qqpAligned ?? false,
      us10yAgainst: body.us10yAgainst ?? false,
      dxyAgainst: body.dxyAgainst ?? false,
      cleanRoomToTarget: body.cleanRoomToTarget ?? true,
      tradesToday,
      lossesToday,
      dailyLossLimitHit: Math.abs(dailyPnl) >= dailyLossLimit,
      maxTradesPerDay,
      maxLosingTradesPerDay,
    }

    const scoreResult = calculateScore(scoreInput)

    const orSize =
      body.orHigh && body.orLow ? parseFloat(body.orHigh) - parseFloat(body.orLow) : null

    const sessionData = {
      date,
      market: body.market ?? 'MNQ',
      orHigh: body.orHigh ? parseFloat(body.orHigh) : null,
      orLow: body.orLow ? parseFloat(body.orLow) : null,
      orSize,
      directionBias: body.directionBias ?? 'neutral',
      hasHighImpactNews: body.hasHighImpactNews ?? false,
      newsNotes: body.newsNotes ?? '',
      vixLevel: body.vixLevel ? parseFloat(body.vixLevel) : null,
      vixExtreme: body.vixExtreme ?? false,
      qqpAligned: body.qqpAligned ?? false,
      us10yAgainst: body.us10yAgainst ?? false,
      dxyAgainst: body.dxyAgainst ?? false,
      cleanRoomToTarget: body.cleanRoomToTarget ?? true,
      score: scoreResult.score,
      decision: scoreResult.decision,
      decisionReason: scoreResult.decisionLabel,
    }

    const session = await prisma.session.upsert({
      where: { date },
      update: sessionData,
      create: sessionData,
    })

    return NextResponse.json({ session, scoreResult })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to save session' }, { status: 500 })
  }
}
