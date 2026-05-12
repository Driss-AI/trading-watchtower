import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getPrimaryAccount, getTrades, type TSXTrade } from '@/lib/topstepx'

// POST /api/trades/import?days=7 — import trades from TopStepX
// Groups fills into round-trip trades by tracking net position.
// Deduplicates fills by ID and removes mirror round trips.

interface RoundTrip {
  direction: 'LONG' | 'SHORT'
  contracts: number
  entry: number
  exit: number
  pnl: number
  fees: number
  entryTime: string
  exitTime: string
  contractId: string
}

export async function POST(req: NextRequest) {
  try {
    const account = await getPrimaryAccount()
    if (!account) {
      return NextResponse.json({ error: 'No TopStepX account found' }, { status: 404 })
    }

    const { searchParams } = new URL(req.url)
    const days = parseInt(searchParams.get('days') ?? '7')

    // If ?clear=true, delete all existing trades first
    if (searchParams.get('clear') === 'true') {
      await prisma.trade.deleteMany({})
      console.log('[Trade Import] Cleared all existing trades')
    }

    const startTime = new Date()
    startTime.setUTCDate(startTime.getUTCDate() - days)
    startTime.setUTCHours(0, 0, 0, 0)

    const fills = await getTrades(account.id, startTime, undefined, 500)
    if (!fills.length) {
      return NextResponse.json({ imported: 0, skipped: 0, message: 'No trades found' })
    }

    // Step 1: Deduplicate fills by ID (TopstepX can return duplicates)
    const uniqueFills: TSXTrade[] = []
    const seenIds = new Set<number>()
    for (const fill of fills) {
      if (seenIds.has(fill.id)) continue
      seenIds.add(fill.id)
      uniqueFills.push(fill)
    }

    console.log(`[Trade Import] ${fills.length} raw fills → ${uniqueFills.length} unique fills`)

    // Step 2: Group fills by date
    const fillsByDate = new Map<string, TSXTrade[]>()
    for (const fill of uniqueFills) {
      const d = new Date(fill.creationTimestamp).toISOString().split('T')[0]
      if (!fillsByDate.has(d)) fillsByDate.set(d, [])
      fillsByDate.get(d)!.push(fill)
    }

    let totalImported = 0
    let totalSkipped = 0

    // Step 3: Process each date
    for (const [date, dayFills] of Array.from(fillsByDate)) {
      const sorted = [...dayFills].sort(
        (a, b) => new Date(a.creationTimestamp).getTime() - new Date(b.creationTimestamp).getTime()
      )

      // Build round trips via net position tracking
      const roundTrips: RoundTrip[] = []
      let netPosition = 0
      let openFills: TSXTrade[] = []

      for (const fill of sorted) {
        const fillSize = fill.side === 0 ? fill.size : -fill.size
        const prevPosition = netPosition
        netPosition += fillSize
        openFills.push(fill)

        // Position closed (went from non-zero to zero)
        if (netPosition === 0 && prevPosition !== 0) {
          const entryFills = openFills.filter(f => prevPosition > 0 ? f.side === 0 : f.side === 1)
          const exitFills = openFills.filter(f => prevPosition > 0 ? f.side === 1 : f.side === 0)

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
              direction, contracts,
              entry: parseFloat(avgEntry.toFixed(2)),
              exit: parseFloat(avgExit.toFixed(2)),
              pnl: totalPnl, fees: totalFees,
              entryTime: entryFills[0].creationTimestamp,
              exitTime: exitFills[exitFills.length - 1].creationTimestamp,
              contractId: entryFills[0].contractId ?? '',
            })
          }
          openFills = []
        }
      }

      // Step 4: Deduplicate mirror round trips
      // If we see entry=A,exit=B AND entry=B,exit=A with same contracts, keep only the first
      const deduped: RoundTrip[] = []
      const mirrorSeen = new Set<string>()
      for (const rt of roundTrips) {
        const priceA = Math.min(rt.entry, rt.exit)
        const priceB = Math.max(rt.entry, rt.exit)
        const key = `${priceA}-${priceB}-${rt.contracts}`
        if (mirrorSeen.has(key)) continue
        mirrorSeen.add(key)
        deduped.push(rt)
      }

      console.log(`[Trade Import] ${date}: ${sorted.length} fills → ${roundTrips.length} raw trips → ${deduped.length} deduped trips`)

      // Step 5: Find or create session
      let session = await prisma.session.findFirst({ where: { date } })
      if (!session) {
        session = await prisma.session.create({ data: { date, market: 'MNQ' } })
      }

      const existing = await prisma.trade.findMany({ where: { date, sessionId: session.id } })

      // Step 6: Insert trades
      for (const rt of deduped) {
        const isDupe = existing.some(t =>
          Math.abs(t.entry - rt.entry) < 0.5 &&
          t.exit !== null && Math.abs(t.exit! - rt.exit) < 0.5 &&
          t.contracts === rt.contracts &&
          t.direction === rt.direction
        )
        if (isDupe) { totalSkipped++; continue }

        const market = rt.contractId.includes('MNQ') ? 'MNQ' : rt.contractId.includes('NQ') ? 'NQ' : 'MNQ'
        const resultPts = rt.direction === 'LONG' ? rt.exit - rt.entry : rt.entry - rt.exit
        const grossPnl = parseFloat(rt.pnl.toFixed(2))
        const tradeFees = parseFloat(rt.fees.toFixed(2))
        const netPnl = parseFloat((rt.pnl - rt.fees).toFixed(2))

        const entryDate = new Date(rt.entryTime)
        const timeStr = entryDate.toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York',
        })

        await prisma.trade.create({
          data: {
            sessionId: session.id, date, time: timeStr, market,
            direction: rt.direction, contracts: rt.contracts,
            entry: rt.entry,
            stop: rt.direction === 'LONG'
              ? parseFloat((rt.entry - Math.abs(rt.exit - rt.entry)).toFixed(2))
              : parseFloat((rt.entry + Math.abs(rt.exit - rt.entry)).toFixed(2)),
            target: rt.exit, exit: rt.exit,
            resultPts: parseFloat(resultPts.toFixed(2)),
            resultDollars: netPnl,
            grossPnl,
            tradeFees,
            resultR: null,
            ruleFollowed: true,
            status: netPnl > 0 ? 'WIN' : netPnl < 0 ? 'LOSS' : 'BE',
            notes: 'Imported from TopStepX',
          },
        })
        totalImported++
      }

      // Update session aggregates
      const sessionTrades = await prisma.trade.findMany({
        where: { sessionId: session.id, status: { not: 'OPEN' } },
      })
      const totalPnl = sessionTrades.reduce((s, t) => s + (t.resultDollars ?? 0), 0)
      const lossCount = sessionTrades.filter(t => t.status === 'LOSS').length
      await prisma.session.update({
        where: { id: session.id },
        data: { dailyPnl: totalPnl, tradesCount: sessionTrades.length, losesCount: lossCount },
      })
    }

    return NextResponse.json({
      imported: totalImported, skipped: totalSkipped,
      message: `Imported ${totalImported} trade(s), skipped ${totalSkipped} duplicate(s)`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Trade Import]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
