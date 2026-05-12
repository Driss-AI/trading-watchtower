import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getPrimaryAccount, getTodayTrades, type TSXTrade } from '@/lib/topstepx'
import { POINT_VALUES } from '@/lib/scoring'

// POST /api/trades/import — auto-import today's trades from TopStepX
// Groups fills into round-trip trades, determines direction from first fill side.
//
// TopStepX fill sides: 0 = BUY, 1 = SELL
//   LONG trade:  BUY fill (entry) → SELL fill (exit)
//   SHORT trade: SELL fill (entry) → BUY fill (exit)

interface RoundTrip {
  direction: 'LONG' | 'SHORT'
  contracts: number
  entry: number
  exit: number
  pnl: number
  fees: number
  entryTime: string

  exitTime: string
}

export async function POST(req: NextRequest) {
  try {
    const account = await getPrimaryAccount()
    if (!account) {
      return NextResponse.json({ error: 'No TopStepX account found' }, { status: 404 })
    }

    const fills = await getTodayTrades(account.id)
    if (!fills.length) {
      return NextResponse.json({ imported: 0, message: 'No trades found today' })
    }

    // Group fills into round-trip trades
    // Strategy: match BUY and SELL fills chronologically
    const buys: TSXTrade[] = []
    const sells: TSXTrade[] = []

    for (const fill of fills) {
      if (fill.side === 0) buys.push(fill)      // BUY
      else if (fill.side === 1) sells.push(fill) // SELL
    }

    // Sort both by timestamp ascending
    buys.sort((a, b) => new Date(a.creationTimestamp).getTime() - new Date(b.creationTimestamp).getTime())
    sells.sort((a, b) => new Date(a.creationTimestamp).getTime() - new Date(b.creationTimestamp).getTime())

    const roundTrips: RoundTrip[] = []

    // Simple pairing: match fills by size and chronological order
    // For each buy, find the matching sell (or vice versa)
    const allFills = [...fills].sort(
      (a, b) => new Date(a.creationTimestamp).getTime() - new Date(b.creationTimestamp).getTime()
    )

    // Track net position to determine round trips
    let netPosition = 0  // positive = long, negative = short
    let openFills: TSXTrade[] = []

    for (const fill of allFills) {
      const fillSize = fill.side === 0 ? fill.size : -fill.size  // BUY = +, SELL = -
      const prevPosition = netPosition
      netPosition += fillSize

      openFills.push(fill)

      // Position closed (went from non-zero to zero)
      if (netPosition === 0 && prevPosition !== 0) {
        const entryFills = openFills.filter(f =>
          prevPosition > 0 ? f.side === 0 : f.side === 1  // entry side matches direction
        )
        const exitFills = openFills.filter(f =>
          prevPosition > 0 ? f.side === 1 : f.side === 0  // exit side is opposite
        )

        if (entryFills.length && exitFills.length) {
          const direction: 'LONG' | 'SHORT' = prevPosition > 0 ? 'LONG' : 'SHORT'
          const contracts = Math.abs(prevPosition)
          const avgEntry = entryFills.reduce((s, f) => s + f.price * f.size, 0) /
                           entryFills.reduce((s, f) => s + f.size, 0)
          const avgExit = exitFills.reduce((s, f) => s + f.price * f.size, 0) /
                          exitFills.reduce((s, f) => s + f.size, 0)
          const totalPnl = [...entryFills, ...exitFills].reduce((s, f) => s + (f.profitAndLoss ?? 0), 0)
          const totalFees = [...entryFills, ...exitFills].reduce((s, f) => s + (f.fees ?? 0), 0)

          roundTrips.push({
            direction,
            contracts,
            entry: parseFloat(avgEntry.toFixed(2)),
            exit: parseFloat(avgExit.toFixed(2)),
            pnl: totalPnl,
            fees: totalFees,
            entryTime: entryFills[0].creationTimestamp,
            exitTime: exitFills[exitFills.length - 1].creationTimestamp,
          })
        }

        openFills = []
      }
    }

    // Also handle if there's still an open position (no exit yet)
    // We skip these — only import completed round trips

    const today = new Date().toISOString().split('T')[0]

    // Find or create session for today
    let sessRes = await prisma.session.findFirst({ where: { date: today } })
    if (!sessRes) {
      sessRes = await prisma.session.create({
        data: { date: today, market: 'MNQ' },
      })
    }

    // Check which trades are already imported (avoid duplicates)
    const existingTrades = await prisma.trade.findMany({
      where: { date: today, sessionId: sessRes.id },
    })

    let imported = 0
    let skipped = 0

    for (const rt of roundTrips) {
      // Check for duplicate by matching entry price + exit price + contracts + direction
      const isDupe = existingTrades.some(t =>
        Math.abs(t.entry - rt.entry) < 0.5 &&
        t.exit !== null && Math.abs(t.exit - rt.exit) < 0.5 &&
        t.contracts === rt.contracts &&
        t.direction === rt.direction
      )

      if (isDupe) {
        skipped++
        continue
      }

      const market = 'MNQ'  // Default — could detect from contractId
      const pointValue = POINT_VALUES[market] ?? 2
      const resultPts = rt.direction === 'LONG' ? rt.exit - rt.entry : rt.entry - rt.exit
      const resultDollars = resultPts * pointValue * rt.contracts
      const resultR = null  // Can't calculate true R without a known stop loss

      const entryDate = new Date(rt.entryTime)
      const timeStr = entryDate.toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/New_York',
      })

      await prisma.trade.create({
        data: {
          sessionId: sessRes.id,
          date: today,
          time: timeStr,
          market,
          direction: rt.direction,
          contracts: rt.contracts,
          entry: rt.entry,
          stop: rt.direction === 'LONG'
            ? parseFloat((rt.entry - Math.abs(rt.exit - rt.entry)).toFixed(2))  // Estimate stop at 1:1
            : parseFloat((rt.entry + Math.abs(rt.exit - rt.entry)).toFixed(2)),
          target: rt.exit,  // Use actual exit as target since trade is done
          exit: rt.exit,
          resultPts: parseFloat(resultPts.toFixed(2)),
          resultDollars: parseFloat(resultDollars.toFixed(2)),
          resultR: parseFloat(resultR.toFixed(2)),
          ruleFollowed: true,
          status: resultDollars > 0 ? 'WIN' : resultDollars < 0 ? 'LOSS' : 'BE',
          notes: `Auto-imported from TopStepX · Gross: $${rt.pnl.toFixed(2)} · Fees: $${rt.fees.toFixed(2)}`,
        },
      })
      imported++
    }

    // Update session aggregates
    const sessionTrades = await prisma.trade.findMany({
      where: { sessionId: sessRes.id, status: { not: 'OPEN' } },
    })
    const totalPnl = sessionTrades.reduce((s, t) => s + (t.resultDollars ?? 0), 0)
    const lossCount = sessionTrades.filter((t) => t.status === 'LOSS').length

    await prisma.session.update({
      where: { id: sessRes.id },
      data: {
        dailyPnl: totalPnl,
        tradesCount: sessionTrades.length,
        losesCount: lossCount,
      },
    })

    return NextResponse.json({
      imported,
      skipped,
      total: roundTrips.length,
      roundTrips,
      message: `Imported ${imported} trade(s), skipped ${skipped} duplicate(s)`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Trade Import]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
