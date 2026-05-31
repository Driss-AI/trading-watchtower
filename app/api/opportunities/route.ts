import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/opportunities?date=YYYY-MM-DD&limit=50
// Lists signal opportunities (taken or skipped) newest-first, with a derived
// isExpired flag so the cockpit can show EXPIRED without a stored sweep.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200)

    const rows = await prisma.signalOpportunity.findMany({
      where: date ? { date } : {},
      orderBy: { barTime: 'desc' },
      take: limit,
    })

    const now = Date.now()
    const opportunities = rows.map((r) => ({
      ...r,
      isExpired:
        r.manualExecutionStatus === 'NOT_TAKEN' &&
        r.signalExpiresAt != null &&
        r.signalExpiresAt.getTime() < now,
    }))

    return NextResponse.json({ opportunities })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to load opportunities' }, { status: 500 })
  }
}
