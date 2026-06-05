export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRecentCandles, getLatestClosedCandle } from '@/lib/candles'
import { getDailyLevels } from '@/lib/levels'
import { buildLiquidityRead } from '@/lib/liquidity'
import { getEngineState } from '@/lib/paper-engine'

function nyDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const levels = await getDailyLevels('MNQ').catch(() => null)
    const bars = getRecentCandles(100)
    const latest = getLatestClosedCandle()

    let read = null
    if (bars.length >= 3 && latest) {
      const sess = await prisma.session.findFirst({ where: { date: nyDate() }, orderBy: { id: 'desc' } }).catch(() => null)
      read = buildLiquidityRead({
        candles: bars,
        lastPrice: latest.close,
        orHigh: sess?.orHigh ?? null,
        orLow: sess?.orLow ?? null,
        levels,
      })
    }

    // Latest engine sweep-reversal recommendation (manual execution only).
    let reversalNote: string | null = null
    try {
      const eng = getEngineState() as any
      reversalNote = eng?.lastBreakout?.reversalNote ?? null
    } catch { /* engine may be idle */ }

    return NextResponse.json({
      levels,
      lastPrice: latest?.close ?? null,
      fvgs: read?.fvgs ?? [],
      classification: read?.classification ?? null,
      text: read?.text ?? null,
      reversalNote,
    })
  } catch (e: any) {
    console.error('[liquidity]', e?.message || e)
    return NextResponse.json({ error: 'liquidity unavailable' }, { status: 500 })
  }
}
