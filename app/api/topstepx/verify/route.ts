// GET /api/topstepx/verify
// Runs every integration check in sequence and returns a full health report.
// Used by the TopstepXStatus dashboard component.

import { NextResponse } from 'next/server'
import {
  getTopstepXToken,
  getPrimaryAccount,
  getOpenPositions,
  getActiveNQContractId,
  getActiveMNQContractId,
  getTodayTrades,
  searchContracts,
  pingAPI,
} from '@/lib/topstepx'
import { testSignalRConnection } from '@/lib/topstepx-ws'

export const dynamic = 'force-dynamic'

interface CheckResult {
  name: string
  status: 'pass' | 'fail' | 'skip'
  detail: string
  data?: Record<string, unknown>
  ms: number
}

async function runCheck(
  name: string,
  fn: () => Promise<Record<string, unknown>>
): Promise<CheckResult> {
  const t0 = Date.now()
  try {
    const data = await fn()
    return { name, status: 'pass', detail: 'OK', data, ms: Date.now() - t0 }
  } catch (err) {
    return {
      name,
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    }
  }
}

export async function GET() {
  const configured =
    !!process.env.TOPSTEPX_USERNAME && !!process.env.TOPSTEPX_API_KEY

  if (!configured) {
    return NextResponse.json({
      configured: false,
      checks: [],
      summary: 'Not configured — add TOPSTEPX_USERNAME and TOPSTEPX_API_KEY to Railway Variables',
    })
  }

  const checks: CheckResult[] = []

  // ── 0. API Reachability Ping ──────────────────────────────────────────────────
  checks.push(
    await runCheck('API reachability (Status/Ping)', async () => {
      const { reachable, latencyMs } = await pingAPI()
      if (!reachable) throw new Error('api.topstepx.com unreachable')
      return { latencyMs }
    })
  )

  // ── 1. Auth ──────────────────────────────────────────────────────────────────
  const authCheck = await runCheck('JWT Authentication', async () => {
    const token = await getTopstepXToken()
    return { tokenLength: token.length, preview: token.slice(0, 12) + '…' }
  })
  checks.push(authCheck)

  // ── 2. Account ───────────────────────────────────────────────────────────────
  let accountId: number | null = null
  const accountCheck = await runCheck('Account data', async () => {
    const account = await getPrimaryAccount()
    if (!account) throw new Error('No active accounts returned')
    accountId = account.id
    return {
      id: account.id,
      name: account.name,
      balance: account.balance,
      canTrade: account.canTrade,
    }
  })
  checks.push(accountCheck)

  // ── 3. Open Positions ────────────────────────────────────────────────────────
  checks.push(
    await runCheck('Open positions', async () => {
      if (!accountId) throw new Error('Account not available')
      const positions = await getOpenPositions(accountId)
      return {
        count: positions.length,
        positions: positions.map((p) => ({
          contract: p.contractId,
          direction: p.type === 1 ? 'LONG' : 'SHORT',
          size: p.size,
          avgPrice: p.averagePrice,
        })),
      }
    })
  )

  // ── 4. Today's Trades ─────────────────────────────────────────────────────────
  checks.push(
    await runCheck("Today's trades", async () => {
      if (!accountId) throw new Error('Account not available')
      const trades = await getTodayTrades(accountId)
      const pnl = trades.reduce((s, t) => s + (t.profitAndLoss ?? 0), 0)
      const fees = trades.reduce((s, t) => s + (t.fees ?? 0), 0)
      return {
        count: trades.length,
        dailyPnL: parseFloat(pnl.toFixed(2)),
        totalFees: parseFloat(fees.toFixed(2)),
        latest: trades[0]
          ? {
              contract: trades[0].contractId,
              side: trades[0].side === 0 ? 'BUY' : 'SELL',
              price: trades[0].price,
              pnl: trades[0].profitAndLoss,
              time: trades[0].creationTimestamp,
            }
          : null,
      }
    })
  )

  // ── 5. NQ Contract ────────────────────────────────────────────────────────────
  checks.push(
    await runCheck('NQ contract ID', async () => {
      const id = await getActiveNQContractId()
      return { contractId: id }
    })
  )

  // ── 6. MNQ Contract ───────────────────────────────────────────────────────────
  checks.push(
    await runCheck('MNQ contract ID', async () => {
      const id = await getActiveMNQContractId()
      return { contractId: id }
    })
  )

  // ── 7. Contract Search ────────────────────────────────────────────────────────
  checks.push(
    await runCheck('Contract search', async () => {
      const contracts = await searchContracts('NQ', true)
      return {
        found: contracts.length,
        sample: contracts.slice(0, 3).map((c) => ({ id: c.id, name: c.name })),
      }
    })
  )

  // ── 8. SignalR WebSocket ──────────────────────────────────────────────────────
  checks.push(
    await runCheck('SignalR WebSocket (User Hub)', async () => {
      const result = await testSignalRConnection()
      if (!result.connected) throw new Error(result.error ?? 'Could not connect')
      return { connected: true }
    })
  )

  const passed = checks.filter((c) => c.status === 'pass').length
  const failed = checks.filter((c) => c.status === 'fail').length

  return NextResponse.json({
    configured: true,
    passed,
    failed,
    total: checks.length,
    ready: failed === 0,
    checks,
    timestamp: new Date().toISOString(),
  })
}
