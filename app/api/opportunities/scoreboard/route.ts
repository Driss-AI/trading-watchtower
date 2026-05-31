import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildScoreboard, type ScoreboardRow } from '@/lib/scoreboard/aggregate'

export const dynamic = 'force-dynamic'

// GET /api/opportunities/scoreboard?source=paper&days=60
// AI-vs-mechanical scoreboard + execution-quality analytics over the
// opportunity log. No new engine — pure queries + the aggregate function.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const source = searchParams.get('source') // null = all sources
    const days = parseInt(searchParams.get('days') ?? '60', 10) || 60

    const where: Record<string, unknown> = {}
    if (source) where.source = source
    if (days > 0) where.createdAt = { gte: new Date(Date.now() - days * 86_400_000) }

    const rows = await prisma.signalOpportunity.findMany({
      where,
      orderBy: { barTime: 'desc' },
      take: 2000,
      select: {
        finalDecision: true, skipSource: true, mechanicalVerdict: true, direction: true,
        outcomeStatus: true, outcomeLabel: true, outcomeR: true, mfeR: true, maeR: true,
        manualExecutionStatus: true, entry: true, actualEntry: true,
        maxChaseDistance: true, executionDelaySeconds: true,
      },
    })

    const scoreboard = buildScoreboard(rows as ScoreboardRow[])
    return NextResponse.json({ scoreboard, meta: { source: source ?? 'all', days } })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to build scoreboard' }, { status: 500 })
  }
}
