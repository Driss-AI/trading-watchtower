export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { connectMarketHub, subscribeToQuote, getLastQuote } from '@/lib/topstepx-ws'
import { startOrderflow, assessBreakout, getOrderflowSnapshot, getShortDelta } from '@/lib/orderflow'
import { getActiveMNQContractId, getActiveNQContractId } from '@/lib/topstepx'

// GET /api/topstepx/orderflow-sim?symbol=MNQ&seconds=60[&level=<price>]
//
// Live order-flow dry-run. Subscribes to the tape + DOM, lets delta and the
// book accumulate for `seconds`, then runs assessBreakout() for a hypothetical
// LONG and SHORT at the current price (or ?level=). Exercises the exact path the
// paper engine uses at a real breakout — useful for sanity-checking the veto
// thresholds against current market conditions. NOT a real ORB backtest (the
// API has no historical tape/DOM).
export async function GET(req: NextRequest) {
  if (!process.env.TOPSTEPX_USERNAME || !process.env.TOPSTEPX_API_KEY) {
    return NextResponse.json({ error: 'TopstepX not configured' }, { status: 503 })
  }

  const symbol  = (req.nextUrl.searchParams.get('symbol') ?? 'MNQ').toUpperCase()
  const seconds = Math.min(120, Math.max(5, parseInt(req.nextUrl.searchParams.get('seconds') ?? '60', 10) || 60))
  const levelParam = parseFloat(req.nextUrl.searchParams.get('level') ?? '')

  let contractId: string
  try {
    contractId = symbol === 'NQ' ? await getActiveNQContractId() : await getActiveMNQContractId()
  } catch (err) {
    return NextResponse.json(
      { error: `Could not resolve ${symbol} contract: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    )
  }

  try {
    await connectMarketHub()
    await subscribeToQuote(contractId)      // for the reference price
    await startOrderflow(contractId)        // subscribes trades + depth, aggregates
    await new Promise((r) => setTimeout(r, seconds * 1000))

    const q = getLastQuote(contractId)
    const mid = q && q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : (q?.price ?? 0)
    const ref = Number.isFinite(levelParam) && levelParam > 0 ? levelParam : mid

    if (!ref || ref <= 0) {
      return NextResponse.json({ error: 'No reference price yet — market quiet or quotes not flowing', contractId }, { status: 503 })
    }

    const long  = assessBreakout('LONG', ref)
    const short = assessBreakout('SHORT', ref)
    const snap  = getOrderflowSnapshot()

    console.log(`[OrderflowSim] ${contractId} ref=${ref} windowΔ=${getShortDelta(seconds * 1000)} | LONG=${long.verdict} SHORT=${short.verdict}`)

    return NextResponse.json({
      note: 'Live order-flow read at the current price — NOT a real ORB breakout. Shows what the engine WOULD decide if price broke here now.',
      contractId,
      windowSeconds: seconds,
      refPrice: ref,
      bestBid: q?.bid ?? null,
      bestAsk: q?.ask ?? null,
      windowDelta: getShortDelta(seconds * 1000),
      snapshot: snap,
      long,
      short,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
