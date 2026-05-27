import { withAuth } from 'next-auth/middleware'

export default withAuth({
  pages: {
    signIn: '/login',
  },
})

export const config = {
  // Protect all routes except auth endpoints, login page, and static assets
  matcher: [
    '/((?!api/auth|api/health|api/test-telegram|api/cron|api/webhooks|_next/static|_next/image|favicon\\.ico|login).*)',
  ],
}
