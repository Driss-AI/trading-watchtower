import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { POINT_VALUES } from '@/lib/scoring'

// PATCH /api/trades/[id] — update a trade (e.g., add exit price)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const existing = await prisma.trade.findUnique({ where: { id: params.id } })
    if (!existing) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })

    const pointValue = POINT_VALUES[existing.market ?? 'MNQ'] ?? 2
    const contracts = body.contracts ? parseInt(body.contracts) : existing.contracts
    const entry = body.entry ? parseFloat(body.entry) : existing.entry
    const stop = body.stop ? parseFloat(body.stop) : existing.stop
    const exit = body.exit ? parseFloat(body.exit) : (existing.exit ?? null)

    const riskPts = Math.abs(entry - stop)
    let resultPts = existing.resultPts
    let resultDollars = existing.resultDollars
    let resultR = existing.resultR
    let status = existing.status

    if (exit !== null) {
      resultPts = existing.direction === 'LONG' ? exit - entry : entry - exit
      resultDollars = resultPts * pointValue * contracts
      resultR = resultPts / (riskPts || 1)
      status = resultDollars > 0 ? 'WIN' : resultDollars < 0 ? 'LOSS' : 'BE'
    }

    const trade = await prisma.trade.update({
      where: { id: params.id },
      data: {
        ...body,
        entry,
        stop,
        exit,
        contracts,
        resultPts,
        resultDollars,
        resultR,
        status,
      },
    })

    // Recalculate session aggregates
    const sessionTrades = await prisma.trade.findMany({
      where: { sessionId: existing.sessionId, status: { not: 'OPEN' } },
    })
    const totalPnl = sessionTrades.reduce((s, t) => s + (t.resultDollars ?? 0), 0)
    const lossCount = sessionTrades.filter((t) => t.status === 'LOSS').length
    const tradeCount = sessionTrades.length

    await prisma.session.update({
      where: { id: existing.sessionId },
      data: { dailyPnl: totalPnl, tradesCount: tradeCount, losesCount: lossCount },
    })

    return NextResponse.json({ trade })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to update trade' }, { status: 500 })
  }
}

// DELETE /api/trades/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.trade.delete({ where: { id: params.id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to delete trade' }, { status: 500 })
  }
}
