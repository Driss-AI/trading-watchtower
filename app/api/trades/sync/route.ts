// POST /api/trades/sync
// Server-side trade sync endpoint for GitHub Actions cron.
// Validates x-cron-secret, then runs the same TopStepX import logic
// as /api/topstepx/sync so the browser tab doesn't need to be open.

import { NextRequest, NextResponse } from 'next/server'
import { getPrimaryAccount, getTodayTrades } from '@/lib/topstepx'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  const expected = process.env.CRON_SECRET
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const account = await getPrimaryAccount()
    if (!account) {
      return NextResponse.json({ error: 'No TopstepX account found' }, { status: 404 })
    }

    const fills = await getTodayTrades(account.id)
    const today = new Date().toISOString().split('T')[0]
    const closedFills = fills.filter(t => t.profitAndLoss !== null && t.profitAndLoss !== undefined)
    let synced = 0

    for (const fill of closedFills) {
      const fillTag = `[topstep:${fill.id}]`
      const existing = await prisma.trade.findFirst({ where: { notes: { contains: fillTag } } })
      if (existing) continue

      let session = await prisma.session.findFirst({ where: { date: today } })
      if (!session) {
        session = await prisma.session.create({
          data: {
            date: today,
            market: fill.contractId.includes('MNQ') ? 'MNQ' : 'NQ',
            decision: 'NO_TRADE',
            decisionReason: 'Auto-created from cron sync',
          },
        })
      }

      const isMNQ = fill.contractId.includes('MNQ')
      const pointValue = isMNQ ? 2 : 20
      const pnlPts = fill.profitAndLoss / pointValue / (fill.size || 1)
      const direction = fill.side === 0 ? 'LONG' : 'SHORT'
      const fillTime = new Date(fill.creationTimestamp)
      const timeStr = fillTime.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })
      const exitPrice = direction === 'LONG' ? fill.price + pnlPts : fill.price - pnlPts
      const riskPts = Math.abs(pnlPts) * 2

      await prisma.trade.create({
        data: {
          sessionId:     session.id,
          date:          today,
          time:          timeStr,
          market:        isMNQ ? 'MNQ' : 'NQ',
          direction,
          contracts:     fill.size,
          entry:         fill.price,
          stop:          direction === 'LONG' ? fill.price - riskPts : fill.price + riskPts,
          target:        direction === 'LONG' ? fill.price + riskPts * 2 : fill.price - riskPts * 2,
          exit:          parseFloat(exitPrice.toFixed(2)),
          resultPts:     parseFloat(pnlPts.toFixed(2)),
          resultDollars: parseFloat(fill.profitAndLoss.toFixed(2)),
          resultR:       pnlPts !== 0 ? parseFloat((pnlPts / (riskPts || 1)).toFixed(2)) : 0,
          status:        fill.profitAndLoss > 0 ? 'WIN' : fill.profitAndLoss < 0 ? 'LOSS' : 'BE',
          ruleFollowed:  true,
          notes:         `Auto-imported from TopstepX ${fillTag}`,
        },
      })
      synced++
    }

    // Update session P&L
    const grossPnl  = fills.reduce((s, t) => s + (t.profitAndLoss ?? 0), 0)
    const totalFees = fills.reduce((s, t) => s + (t.fees ?? 0), 0)
    const netPnl    = grossPnl - totalFees
    const session   = await prisma.session.findFirst({ where: { date: today } })
    if (session && closedFills.length > 0) {
      await prisma.session.update({
        where: { date: today },
        data: {
          dailyPnl:    parseFloat(netPnl.toFixed(2)),
          tradesCount: closedFills.length,
          losesCount:  closedFills.filter(t => (t.profitAndLoss ?? 0) < 0).length,
        },
      })
    }

    return NextResponse.json({ synced, timestamp: new Date().toISOString() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/trade-sync]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
