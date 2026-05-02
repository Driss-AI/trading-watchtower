import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/settings
export async function GET() {
  try {
    let settings = await prisma.settings.findFirst()
    if (!settings) {
      settings = await prisma.settings.create({
        data: { id: 1 },
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

    // Safety: never allow order execution to be enabled
    const safeBody = { ...body, enableOrderExecution: false }

    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: safeBody,
      create: { id: 1, ...safeBody },
    })

    return NextResponse.json({ settings })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
