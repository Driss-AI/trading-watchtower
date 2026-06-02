import { NextRequest, NextResponse } from 'next/server'
import { recordManualExecution } from '@/lib/opportunity-log/record'
import type { ManualExecutionStatus } from '@/lib/signal-engine/types'

export const dynamic = 'force-dynamic'

const ALLOWED: ManualExecutionStatus[] = [
  'NOT_TAKEN', 'TAKEN', 'SKIPPED', 'MISSED', 'CANCELLED', 'EXPIRED',
]

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

// POST /api/opportunities/[id]/execution — log the user's real manual action.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json()
    const status = body.status as ManualExecutionStatus
    if (!ALLOWED.includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 })
    }

    await recordManualExecution({
      opportunityId: params.id,
      status,
      actualEntry: num(body.actualEntry),
      actualContracts: body.actualContracts != null ? Math.max(0, Math.floor(num(body.actualContracts) ?? 0)) : null,
      priceAtExecution: num(body.priceAtExecution),
      manualOverrideReason: body.manualOverrideReason ? String(body.manualOverrideReason).slice(0, 500) : null,
      expiredReason: body.expiredReason ? String(body.expiredReason).slice(0, 500) : null,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(err)
    if (err instanceof Error && err.message.startsWith('Validation:')) {
      return NextResponse.json({ error: err.message.replace(/^Validation:\s*/, '') }, { status: 400 })
    }
    const msg = err instanceof Error && err.message.includes('not found') ? err.message : 'Failed to record execution'
    const code = msg.includes('not found') ? 404 : 500
    return NextResponse.json({ error: msg }, { status: code })
  }
}
