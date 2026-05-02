import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { POINT_VALUES } from '@/lib/scoring'

// GET /api/trades — list trades (optionally filter by date)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date')
    const limit = parseInt(searchParams.get('limit') ?? '50')

    const trades = await prisma.trade.findMany({
      where: date ? { date } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ trades })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch trades' }, { status: 500 })
  }
}

// POST /api/trades — log a new trade
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const date = body.date ?? new Date().toISOString().split('T')[0]

    // Validate required fields
    if (!body.sessionId || !body.direction || !body.entry || !body.stop || !body.target) {
      return NextResponse.json(
        { error: 'Missing required fields: sessionId, direction, entry, stop, target' },
        { status: 400 }
      )
    }

    const pointValue = POINT_VALUES[body.market ?? 'MNQ'] ?? 2
    const contracts = parseInt(body.contracts ?? '1')
    const entry = parseFloat(body.entry)
    const stop = parseFloat(body.stop)
    const target = parseFloat(body.target)
    const exit = body.exit ? parseFloat(body.exit) : null

    const riskPts = Math.abs(entry - stop)

    // Calculate result if exit is provided
    let resultPts: number | null = null
    let resultDollars: number | null = null
    let resultR: number | null = null
    let status = 'OPEN'

    if (exit !== null) {
      resultPts =
        body.direction === 'LONG' ? exit - entry : entry - exit
      resultDollars = resultPts * pointValue * contracts
      resultR = resultPts / (riskPts || 1)
      status = resultDollars > 0 ? 'WIN' : resultDollars < 0 ? 'LOSS' : 'BE'
    }

    const trade = await prisma.trade.create({
      data: {
        sessionId: body.sessionId,
        date,
        time: body.time ?? new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        market: body.market ?? 'MNQ',
        direction: body.direction,
        contracts,
        entry,
        stop,
        target,
        exit,
        resultPts,
        resultDollars,
        resultR,
        setupScore: body.setupScore ? parseInt(body.setupScore) : null,
        ruleFollowed: body.ruleFollowed ?? true,
        emotionLevel: body.emotionLevel ? parseInt(body.emotionLevel) : null,
        mistakeNotes: body.mistakeNotes ?? '',
        notes: body.notes ?? '',
        status,
      },
    })

    // Update session aggregates
    const sessionTrades = await prisma.trade.findMany({
      where: { sessionId: body.sessionId, status: { not: 'OPEN' } },
    })

    const totalPnl = sessionTrades.reduce((s, t) => s + (t.resultDollars ?? 0), 0)
    const lossCount = sessionTrades.filter((t) => t.status === 'LOSS').length
    const tradeCount = sessionTrades.length

    await prisma.session.update({
      where: { id: body.sessionId },
      data: {
        dailyPnl: totalPnl,
        tradesCount: tradeCount,
        losesCount: lossCount,
      },
    })

    return NextResponse.json({ trade })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to log trade' }, { status: 500 })
  }
}
