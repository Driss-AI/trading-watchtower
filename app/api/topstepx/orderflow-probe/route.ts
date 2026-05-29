export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import {
  connectMarketHub,
  subscribeToTradesAndDepth,
  getOrderflowSamples,
  resetOrderflowSamples,
  getConnectionStatus,
} from '@/lib/topstepx-ws'
import { getActiveMNQContractId, getActiveNQContractId } from '@/lib/topstepx'

// GET /api/topstepx/orderflow-probe?symbol=MNQ&seconds=10
//
// One-shot diagnostic. Subscribes to the trade tape (GatewayTrade) and DOM
// (GatewayDepth) for the combine/sim contract, collects raw payloads for a few
// seconds, and returns them. Confirms order-flow data actually streams on the
// eval feed before we build delta / liquidity-heatmap aggregation on top of it.
export async function GET(req: NextRequest) {
  if (!process.env.TOPSTEPX_USERNAME || !process.env.TOPSTEPX_API_KEY) {
    return NextResponse.json({ error: 'TopstepX not configured' }, { status: 503 })
  }

  const symbol  = (req.nextUrl.searchParams.get('symbol') ?? 'MNQ').toUpperCase()
  const seconds = Math.min(20, Math.max(2, parseInt(req.nextUrl.searchParams.get('seconds') ?? '10', 10) || 10))

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
    resetOrderflowSamples()
    await connectMarketHub()
    await subscribeToTradesAndDepth(contractId)
    await new Promise((r) => setTimeout(r, seconds * 1000))

    const s = getOrderflowSamples()
    const trades = s.tradeSamples.filter((x) => x.contractId === contractId)
    const depth  = s.depthSamples.filter((x) => x.contractId === contractId)

    return NextResponse.json({
      contractId,
      windowSeconds: seconds,
      hub: getConnectionStatus(),
      trades: {
        totalReceivedAllContracts: s.tradeCount,
        forThisContract: trades.length,
        subscribed: s.subscribedTrades,
        samples: trades.slice(0, 10),
      },
      depth: {
        totalReceivedAllContracts: s.depthCount,
        forThisContract: depth.length,
        subscribed: s.subscribedDepth,
        samples: depth.slice(0, 10),
      },
      verdict: {
        tape: s.tradeCount > 0 ? 'streaming' : 'no data — market closed or tape not entitled on this feed',
        dom:  s.depthCount > 0 ? 'streaming' : 'no data — market closed or DOM not entitled on this feed',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
