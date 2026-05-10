// middleware.ts — Auth gate for ALL routes
// Protects every page and API endpoint behind a simple token cookie.
//
// HOW TO USE:
// 1. Set WATCHTOWER_AUTH_TOKEN in Railway env vars (any random string, e.g. "mySecret123")
// 2. Visit: https://trading-watchtower-production.up.railway.app/?token=mySecret123
// 3. Cookie is set → you're authenticated for 1 year
// 4. All API and page routes are now protected
//
// If WATCHTOWER_AUTH_TOKEN is not set, auth is DISABLED (dev mode).

import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const token = process.env.WATCHTOWER_AUTH_TOKEN
  // No token configured = auth disabled (for local dev)
  if (!token) return NextResponse.next()

  // 1. Check cookie
  const cookie = req.cookies.get('watchtower_auth')?.value
  if (cookie === token) return NextResponse.next()

  // 2. Check ?token= query param (one-time login URL)
  const paramToken = req.nextUrl.searchParams.get('token')
  if (paramToken === token) {
    // Valid token in URL → set cookie and redirect to clean URL
    const url = req.nextUrl.clone()
    url.searchParams.delete('token')
    const res = NextResponse.redirect(url)
    res.cookies.set('watchtower_auth', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    })
    return res
  }

  // 3. Unauthorized
  // API routes → 401 JSON
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Page routes → plain text message with instructions
  return new NextResponse(
    '🔒 Watchtower is locked.\n\nAdd ?token=YOUR_TOKEN to the URL to authenticate.\nExample: https://your-app.up.railway.app/?token=YOUR_TOKEN\n\nSet WATCHTOWER_AUTH_TOKEN in Railway env vars first.',
    { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  )
}

export const config = {
  // Protect everything except Next.js internals, static files, and health endpoint
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
}
