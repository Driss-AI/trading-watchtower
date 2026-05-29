import { NextRequest, NextResponse } from 'next/server'
import { startEngine, stopEngine, configureEngine, getEngineState } from '@/lib/paper-engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const state = getEngineState()
  return NextResponse.json(state)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, config } = body as { action: string; config?: Record<string, unknown> }

    switch (action) {
      case 'start':
        await startEngine()
        return NextResponse.json({ ok: true, state: getEngineState() })

      case 'stop':
        await stopEngine()
        return NextResponse.json({ ok: true, state: getEngineState() })

      case 'configure':
        if (config) configureEngine(config as any)
        return NextResponse.json({ ok: true, state: getEngineState() })

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    console.error('[PaperEngine API] Action failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Paper engine action failed' },
      { status: 500 },
    )
  }
}
