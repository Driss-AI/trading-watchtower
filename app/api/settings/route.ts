export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Fields that are SAFE to return to the frontend.
// NEVER return: topstepxApiKey, topstepxUsername, topstepxAccountId,
//               telegramBotToken, telegramChatId, tradingViewWebhookSecret
const SAFE_SELECT = {
  id: true,
  accountSize: true,
  dailyLossLimit: true,
  trailingDrawdown: true,
  profitTarget: true,
  maxTradesPerDay: true,
  maxLosingTradesPerDay: true,
  mnqEnabled: true,
  nqEnabled: true,
  enableOrderExecution: true,
  topstepxBaseUrl: true,
  updatedAt: true,
}

// GET /api/settings — returns ONLY safe fields (no secrets)
export async function GET() {
  try {
    let settings = await prisma.settings.findFirst({
      select: SAFE_SELECT,
    })
    if (!settings) {
      settings = await prisma.settings.create({
        data: { id: 1 },
        select: SAFE_SELECT,
      })
    }
    return NextResponse.json({ settings })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

// PUT /api/settings — update settings
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()

    // Safety: never allow order execution to be enabled via API
    const safeBody = { ...body, enableOrderExecution: false }

    // Strip any secret fields from the update body to prevent
    // accidentally overwriting them with empty/wrong values from frontend
    delete safeBody.topstepxApiKey
    delete safeBody.topstepxUsername
    delete safeBody.topstepxAccountId
    delete safeBody.telegramBotToken
    delete safeBody.telegramChatId
    delete safeBody.tradingViewWebhookSecret

    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: safeBody,
      create: { id: 1, ...safeBody },
      select: SAFE_SELECT,
    })

    return NextResponse.json({ settings })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
