import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/backtest?limit=20 — list recent backtest runs (newest first).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 100)

    const runs = await prisma.backtestRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ runs })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to load backtest runs' }, { status: 500 })
  }
}
