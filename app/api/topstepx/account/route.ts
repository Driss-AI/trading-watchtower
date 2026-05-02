import { NextResponse } from 'next/server'
import { getPrimaryAccount, getOpenPositions, testConnection } from '@/lib/topstepx'
import { prisma } from '@/lib/prisma'

// GET /api/topstepx/account — fetch live account data from TopstepX
export async function GET() {
  try {
    const account = await getPrimaryAccount()

    if (!account) {
      return NextResponse.json({ error: 'No active accounts found', account: null }, { status: 404 })
    }

    const positions = await getOpenPositions(account.id)

    // Sync to DB
    const today = new Date().toISOString().split('T')[0]
    await prisma.accountSnapshot.upsert({
      where: { id: `topstepx-${today}` } as any,
      update: {
        balance: account.balance,
        source: 'topstepx',
      },
      create: {
        date: today,
        balance: account.balance,
        dailyPnl: 0,
        totalPnl: 0,
        source: 'topstepx',
      },
    })

    // Update broker connection status
    await prisma.brokerConnection.upsert({
      where: { id: 'topstepx-main' },
      update: { status: 'connected', lastSync: new Date() },
      create: {
        id: 'topstepx-main',
        provider: 'topstepx',
        status: 'connected',
        lastSync: new Date(),
      },
    })

    return NextResponse.json({
      account: {
        id: account.id,
        name: account.name,
        balance: account.balance,
        canTrade: account.canTrade,
      },
      positions: positions.map((p) => ({
        contractId: p.contractId,
        direction: p.type === 1 ? 'LONG' : 'SHORT',
        size: p.size,
        averagePrice: p.averagePrice,
      })),
      syncedAt: new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    // Update connection status to error
    try {
      await prisma.brokerConnection.upsert({
        where: { id: 'topstepx-main' },
        update: { status: 'error', notes: msg },
        create: { id: 'topstepx-main', provider: 'topstepx', status: 'error', notes: msg },
      })
    } catch {}

    return NextResponse.json({ error: msg, account: null }, { status: 500 })
  }
}
