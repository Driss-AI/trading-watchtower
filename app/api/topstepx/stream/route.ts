// GET /api/topstepx/stream?hub=user|market&contractId=CON.F.US.NQ.M25
//
// Server-Sent Events endpoint. The browser connects here and receives
// real-time TopstepX events forwarded from the SignalR hub.
//
// Query params:
//   hub        — "user" (trades, account, positions) | "market" (quotes)
//   contractId — required when hub=market, e.g. CON.F.US.NQ.M25

import { NextRequest } from 'next/server'
import {
  connectUserHub,
  connectMarketHub,
  subscribeToQuote,
  subscribe,
  getConnectionStatus,
  type WSEvent,
} from '@/lib/topstepx-ws'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const hub        = req.nextUrl.searchParams.get('hub') ?? 'user'
  const contractId = req.nextUrl.searchParams.get('contractId')

  if (!process.env.TOPSTEPX_USERNAME || !process.env.TOPSTEPX_API_KEY) {
    return new Response('TopstepX not configured', { status: 503 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: WSEvent) {
        try {
          const payload = `data: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(payload))
        } catch {
          // Client disconnected
        }
      }

      // Connect the right hub
      try {
        if (hub === 'market') {
          await connectMarketHub()
          if (contractId) {
            await subscribeToQuote(contractId)
          }
        } else {
          await connectUserHub()
        }
      } catch (err) {
        send({
          type: 'error',
          hub,
          message: err instanceof Error ? err.message : 'Connection failed',
        })
      }

      // Send current connection status immediately
      const status = getConnectionStatus()
      send({ type: 'connected', hub })
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'status', data: status })}\n\n`)
      )

      // Subscribe to all events and forward to this SSE client
      const unsubscribe = subscribe((event) => {
        // For market hub, only forward events relevant to this connection
        if (hub === 'market' && event.type !== 'quote' && event.type !== 'connected' && event.type !== 'disconnected') return
        if (hub === 'user'   && event.type === 'quote') return
        send(event)
      })

      // Keep-alive ping every 25s (prevents nginx/Railway from closing idle connections)
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`))
        } catch {
          clearInterval(pingInterval)
        }
      }, 25_000)

      // Cleanup when client disconnects
      req.signal.addEventListener('abort', () => {
        clearInterval(pingInterval)
        unsubscribe()
        try { controller.close() } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection:      'keep-alive',
      'X-Accel-Buffering': 'no',  // disable nginx buffering on Railway
    },
  })
}
