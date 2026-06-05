export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import Anthropic from '@anthropic-ai/sdk'
import { authOptions } from '@/lib/auth'
import { TRADE_MODEL } from '@/lib/trading-ai'
import { buildBrainContext } from '@/lib/brain/snapshot'

let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
    _client = new Anthropic({ apiKey })
  }
  return _client
}

const BRAIN_SYSTEM = `You are the WATCHTOWER BRAIN — the same AI that confirms and sizes ORB breakout entries on MNQ for a TopStep 50K combine. You are talking to the trader live, inside their cockpit.

You are an ADVISOR ONLY. You never place, modify, or cancel trades, and you never claim to have done so. You read the live data and give a sharp, concise, honest read.

Strategy frame: 15-minute opening range (9:30–9:45 ET), trade window until 11:30 ET. Long above OR High, short below OR Low. Confirm breakouts with candle pattern + volume + order flow. Size by risk against the daily loss limit and the trailing drawdown. Reversal/trap awareness matters: a break that closes back inside the OR within a bar and then reverses is a fade, not a chase.

How to answer:
- Be concise and specific. Cite the actual numbers from the live snapshot (candle sequence, OR levels, delta, volume, recent signals).
- Read the candle SEQUENCE, not just the last bar — momentum building/fading, multi-bar sweeps of OR levels, compression before a move.
- If the tape is stale or a section says unavailable, say so plainly — never invent data.
- When asked for a read, give a clear lean (long / short / stand aside), the why, and the risk.
- Plain text. No markdown headings. Short paragraphs or tight bullets.`

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({}))
    const raw = Array.isArray(body?.messages) ? body.messages : []
    const convo = raw
      .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
      .slice(-20)
      .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, 4000) }))

    if (convo.length === 0 || convo[convo.length - 1].role !== 'user') {
      return NextResponse.json({ error: 'no user message' }, { status: 400 })
    }

    const context = await buildBrainContext({ includeMacro: true })
    const system = `${BRAIN_SYSTEM}\n\n=== LIVE CONTEXT (auto-attached, current as of this message) ===\n${context}`

    const resp = await getClient().messages.create({
      model: TRADE_MODEL,
      max_tokens: 1024,
      system,
      messages: convo,
    })

    const reply = resp.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
      .trim()

    return NextResponse.json({ reply: reply || '(no response)' })
  } catch (e: any) {
    console.error('[brain/chat]', e?.message || e)
    return NextResponse.json({ error: 'Brain unavailable right now — try again in a moment.' }, { status: 500 })
  }
}
