// GET /api/topstepx/stream?hub=user
// GET /api/topstepx/stream?hub=market&contractId=CON.F.US.MNQ.M26
// GET /api/topstepx/stream?hub=market&symbol=MNQ           (resolves contract server-side)
// GET /api/topstepx/stream?hub=market&symbol=NQ
//
// Server-Sent Events endpoint. The browser connects here and receives
// real-time TopstepX events forwarded from the SignalR hub.

import { NextRequest } from 'next/server'
import {
  connectUserHub,
  connectMarketHub,
  subscribeToQuote,
  subscribe,
  getConnectionStatus,
  getLastQuote,
  type WSEvent,
} from '@/lib/topstepx-ws'
import { getActiveNQContractId, getActiveMNQContractId } from '@/lib/topstepx'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function resolveContractId(symbolOrId: string | null, contractId: string | null): Promise<string | null> {
  if (contractId) return contractId
  if (!symbolOrId) return null
  const sym = symbolOrId.toUpperCase()
  if (sym === 'NQ')  return getActiveNQContractId()
  if (sym === 'MNQ') return getActiveMNQContractId()
  // Allow caller to pass a symbol root we don't know about — caller can use
  // ?contractId= directly in that case.
  return null
}

export async function GET(req: NextRequest) {
  const hub             = req.nextUrl.searchParams.get('hub') ?? 'user'
  const symbolParam     = req.nextUrl.searchParams.get('symbol')
  const contractIdParam = req.nextUrl.searchParams.get('contractId')

  if (!process.env.TOPSTEPX_USERNAME || !process.env.TOPSTEPX_API_KEY) {
    return new Response('TopstepX not configured', { status: 503 })
  }

  // For market hub: resolve to a concrete contractId now so we can filter
  // events to ONLY the contract this client cares about.
  let resolvedContractId: string | null = null
  if (hub === 'market') {
    try {
      resolvedContractId = await resolveContractId(symbolParam, contractIdParam)
    } catch (err) {
      return new Response(`Could not resolve contract: ${err instanceof Error ? err.message : err}`, { status: 400 })
    }
    if (!resolvedContractId) {
      return new Response('hub=market requires either ?contractId= or ?symbol=NQ|MNQ', { status: 400 })
    }
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: WSEvent | Record<string, unknown>) {
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
          if (resolvedContractId) await subscribeToQuote(resolvedContractId)
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

      // Send hello + current connection status immediately
      send({ type: 'connected', hub, contractId: resolvedContractId ?? undefined })
      const status = getConnectionStatus()
      send({ type: 'status', data: status })

      // For market hub, immediately replay the last known quote (if any) so
      // the client doesn't have to wait for the next tick to render.
      if (hub === 'market' && resolvedContractId) {
        const last = getLastQuote(resolvedContractId)
        if (last) send({ type: 'quote', data: last })
      }

      // Subscribe to all events and forward to this SSE client.
      const unsubscribe = subscribe((event) => {
        if (hub === 'market') {
          // Allow connection lifecycle events through.
          if (event.type === 'connected' || event.type === 'disconnected') {
            send(event)
            return
          }
          // Only forward QUOTE events that match this client's contract.
          if (event.type !== 'quote') return
          if (event.data?.contractId !== resolvedContractId) return
          send(event)
          return
        }

        // hub === 'user': drop any market-side noise.
        if (event.type === 'quote') return
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
