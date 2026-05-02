import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/performance — aggregate stats across all trades
export async function GET() {
  try {
    const trades = await prisma.trade.findMany({
      where: { status: { not: 'OPEN' } },
      orderBy: { createdAt: 'asc' },
    })

    if (trades.length === 0) {
      return NextResponse.json({
        stats: {
          totalTrades: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          totalPnl: 0,
          totalR: 0,
          avgR: 0,
          profitFactor: 0,
          avgWin: 0,
          avgLoss: 0,
          biggestWin: 0,
          biggestLoss: 0,
          ruleFollowingPct: 0,
          byDirection: { LONG: { trades: 0, pnl: 0 }, SHORT: { trades: 0, pnl: 0 } },
          byScoreBucket: [],
          recentTrades: [],
        },
      })
    }

    const wins = trades.filter((t) => t.status === 'WIN')
    const losses = trades.filter((t) => t.status === 'LOSS')
    const totalPnl = trades.reduce((s, t) => s + (t.resultDollars ?? 0), 0)
    const totalR = trades.reduce((s, t) => s + (t.resultR ?? 0), 0)
    const grossWin = wins.reduce((s, t) => s + (t.resultDollars ?? 0), 0)
    const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.resultDollars ?? 0), 0))
    const ruleFollowed = trades.filter((t) => t.ruleFollowed).length

    // By direction
    const byDirection = {
      LONG: {
        trades: trades.filter((t) => t.direction === 'LONG').length,
        pnl: trades.filter((t) => t.direction === 'LONG').reduce((s, t) => s + (t.resultDollars ?? 0), 0),
      },
      SHORT: {
        trades: trades.filter((t) => t.direction === 'SHORT').length,
        pnl: trades.filter((t) => t.direction === 'SHORT').reduce((s, t) => s + (t.resultDollars ?? 0), 0),
      },
    }

    // By score bucket
    const buckets = [
      { label: 'No Score', min: -1, max: -1 },
      { label: '0–64 (No Trade)', min: 0, max: 64 },
      { label: '65–79 (Caution)', min: 65, max: 79 },
      { label: '80–100 (Trade)', min: 80, max: 100 },
    ]

    const byScoreBucket = buckets.map((b) => {
      const bucketTrades =
        b.min === -1
          ? trades.filter((t) => t.setupScore === null)
          : trades.filter((t) => t.setupScore !== null && t.setupScore >= b.min && t.setupScore <= b.max)
      const bucketWins = bucketTrades.filter((t) => t.status === 'WIN').length
      return {
        label: b.label,
        trades: bucketTrades.length,
        wins: bucketWins,
        winRate: bucketTrades.length > 0 ? ((bucketWins / bucketTrades.length) * 100).toFixed(0) : '0',
        pnl: bucketTrades.reduce((s, t) => s + (t.resultDollars ?? 0), 0),
      }
    })

    return NextResponse.json({
      stats: {
        totalTrades: trades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: ((wins.length / trades.length) * 100).toFixed(1),
        totalPnl: totalPnl.toFixed(0),
        totalR: totalR.toFixed(2),
        avgR: (totalR / trades.length).toFixed(2),
        profitFactor: grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : grossWin > 0 ? '∞' : '0',
        avgWin: wins.length > 0 ? (grossWin / wins.length).toFixed(0) : '0',
        avgLoss: losses.length > 0 ? (grossLoss / losses.length).toFixed(0) : '0',
        biggestWin: wins.length > 0 ? Math.max(...wins.map((t) => t.resultDollars ?? 0)).toFixed(0) : '0',
        biggestLoss: losses.length > 0 ? Math.abs(Math.min(...losses.map((t) => t.resultDollars ?? 0))).toFixed(0) : '0',
        ruleFollowingPct: ((ruleFollowed / trades.length) * 100).toFixed(0),
        byDirection,
        byScoreBucket,
        recentTrades: trades.slice(-20).reverse(),
      },
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch performance' }, { status: 500 })
  }
}
