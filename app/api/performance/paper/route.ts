import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const trades = await prisma.trade.findMany({
      where: { source: 'paper', status: { not: 'OPEN' } },
      orderBy: { createdAt: 'asc' },
    })

    const wins = trades.filter((t) => t.status === 'WIN')
    const losses = trades.filter((t) => t.status === 'LOSS')
    const totalPnl = trades.reduce((s, t) => s + (t.resultDollars ?? 0), 0)
    const totalR = trades.reduce((s, t) => s + (t.resultR ?? 0), 0)
    const grossWin = wins.reduce((s, t) => s + (t.resultDollars ?? 0), 0)
    const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.resultDollars ?? 0), 0))

    const winRate = trades.length > 0 ? wins.length / trades.length : 0
    const lossRate = trades.length > 0 ? losses.length / trades.length : 0
    const avgWin = wins.length > 0 ? grossWin / wins.length : 0
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0
    const expectancy = (winRate * avgWin) - (lossRate * avgLoss)
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0

    // Distinct trading days
    const uniqueDates = Array.from(new Set(trades.map((t) => t.date)))

    // Daily breakdown + max drawdown + equity curve
    const dailyMap = new Map<string, { trades: number; wins: number; losses: number; pnl: number }>()
    for (const t of trades) {
      const d = dailyMap.get(t.date) ?? { trades: 0, wins: 0, losses: 0, pnl: 0 }
      d.trades++
      if (t.status === 'WIN') d.wins++
      if (t.status === 'LOSS') d.losses++
      d.pnl += t.resultDollars ?? 0
      dailyMap.set(t.date, d)
    }

    let cumPnl = 0
    let peak = 0
    let maxDrawdown = 0
    let worstDay = { date: '', pnl: 0 }
    let bestDay = { date: '', pnl: 0 }

    const dailyBreakdown = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => {
        cumPnl += d.pnl
        if (cumPnl > peak) peak = cumPnl
        const dd = peak - cumPnl
        if (dd > maxDrawdown) maxDrawdown = dd
        if (d.pnl < worstDay.pnl) worstDay = { date, pnl: d.pnl }
        if (d.pnl > bestDay.pnl) bestDay = { date, pnl: d.pnl }
        return {
          date,
          trades: d.trades,
          wins: d.wins,
          losses: d.losses,
          pnl: parseFloat(d.pnl.toFixed(2)),
          winRate: d.trades > 0 ? Math.round((d.wins / d.trades) * 100) : 0,
          cumPnl: parseFloat(cumPnl.toFixed(2)),
        }
      })

    // Streaks
    let currentStreak = 0
    let currentStreakType: 'win' | 'loss' | null = null
    let longestWinStreak = 0
    let longestLossStreak = 0
    let runningWin = 0
    let runningLoss = 0

    for (const t of trades) {
      if (t.status === 'WIN') {
        runningWin++
        runningLoss = 0
        if (runningWin > longestWinStreak) longestWinStreak = runningWin
      } else if (t.status === 'LOSS') {
        runningLoss++
        runningWin = 0
        if (runningLoss > longestLossStreak) longestLossStreak = runningLoss
      }
    }

    if (trades.length > 0) {
      const last = trades[trades.length - 1]
      if (last.status === 'WIN') {
        currentStreakType = 'win'
        currentStreak = runningWin
      } else if (last.status === 'LOSS') {
        currentStreakType = 'loss'
        currentStreak = runningLoss
      }
    }

    // AI vs mechanical
    const aiConfirmed = trades.filter((t) => t.aiReasoning && !t.aiReasoning.includes('mechanical') && !t.aiReasoning.includes('fallback')).length
    const aiPct = trades.length > 0 ? Math.round((aiConfirmed / trades.length) * 100) : 0

    // Validation criteria
    const criteria = [
      { label: '30+ trading days', passed: uniqueDates.length >= 30, value: `${uniqueDates.length}/30` },
      { label: '50+ trades', passed: trades.length >= 50, value: `${trades.length}/50` },
      { label: 'Positive expectancy', passed: expectancy > 0, value: `$${expectancy.toFixed(2)}` },
      { label: 'Win rate > 40%', passed: winRate > 0.4, value: `${(winRate * 100).toFixed(1)}%` },
      { label: 'Profit factor > 1.0', passed: profitFactor > 1.0, value: profitFactor === Infinity ? '∞' : profitFactor.toFixed(2) },
    ]
    const criteriaPassedCount = criteria.filter((c) => c.passed).length

    // Recent trades
    const recentTrades = trades.slice(-20).reverse().map((t) => ({
      id: t.id,
      date: t.date,
      time: t.time,
      direction: t.direction,
      contracts: t.contracts,
      entry: t.entry,
      exit: t.exit,
      resultPts: t.resultPts,
      resultDollars: t.resultDollars,
      resultR: t.resultR,
      status: t.status,
      aiReasoning: t.aiReasoning ? t.aiReasoning.slice(0, 120) : null,
    }))

    return NextResponse.json({
      stats: {
        totalTrades: trades.length,
        totalDays: uniqueDates.length,
        wins: wins.length,
        losses: losses.length,
        winRate: (winRate * 100).toFixed(1),
        totalPnl: parseFloat(totalPnl.toFixed(2)),
        totalR: parseFloat(totalR.toFixed(2)),
        avgR: trades.length > 0 ? parseFloat((totalR / trades.length).toFixed(2)) : 0,
        expectancy: parseFloat(expectancy.toFixed(2)),
        profitFactor: profitFactor === Infinity ? '∞' : profitFactor.toFixed(2),
        avgWin: parseFloat(avgWin.toFixed(0)),
        avgLoss: parseFloat(avgLoss.toFixed(0)),
        maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
        worstDay,
        bestDay,
        streak: { current: currentStreak, type: currentStreakType, longestWin: longestWinStreak, longestLoss: longestLossStreak },
        aiPct,
        criteria,
        criteriaPassedCount,
        allCriteriaMet: criteriaPassedCount === criteria.length,
        dailyBreakdown,
        recentTrades,
        byDirection: {
          LONG: {
            trades: trades.filter((t) => t.direction === 'LONG').length,
            pnl: trades.filter((t) => t.direction === 'LONG').reduce((s, t) => s + (t.resultDollars ?? 0), 0),
          },
          SHORT: {
            trades: trades.filter((t) => t.direction === 'SHORT').length,
            pnl: trades.filter((t) => t.direction === 'SHORT').reduce((s, t) => s + (t.resultDollars ?? 0), 0),
          },
        },
      },
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch paper performance' }, { status: 500 })
  }
}
