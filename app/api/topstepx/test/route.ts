import { NextResponse } from 'next/server'
import { testConnection } from '@/lib/topstepx'

// GET /api/topstepx/test — test API connection + show account
export async function GET() {
  const result = await testConnection()
  return NextResponse.json(result, { status: result.connected ? 200 : 503 })
}
