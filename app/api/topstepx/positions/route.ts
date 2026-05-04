import { NextResponse } from 'next/server'
import { getPrimaryAccount, getOpenPositions } from '@/lib/topstepx'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const account   = await getPrimaryAccount()
    if (!account) return NextResponse.json({ positions: [] })
    const positions = await getOpenPositions(account.id)
    return NextResponse.json({ positions })
  } catch (err) {
    return NextResponse.json({ positions: [], error: String(err) }, { status: 500 })
  }
}
