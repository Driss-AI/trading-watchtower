import { describe, it, expect } from 'vitest'
import { tradingViewWebhookSchema } from './webhook-schema'

const validPayload = {
  secret: 'test-secret',
  symbol: 'MNQ',
  event: 'ORB_BREAKOUT',
  direction: 'LONG' as const,
  price: 18450.25,
  or_high: 18440.0,
  or_low: 18390.0,
  timestamp: '2026-01-15T10:05:00-04:00',
}

describe('tradingViewWebhookSchema', () => {
  it('accepts valid payload', () => {
    const result = tradingViewWebhookSchema.safeParse(validPayload)
    expect(result.success).toBe(true)
  })

  it('rejects missing secret', () => {
    const { secret, ...rest } = validPayload
    const result = tradingViewWebhookSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects missing symbol', () => {
    const { symbol, ...rest } = validPayload
    const result = tradingViewWebhookSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects missing price', () => {
    const { price, ...rest } = validPayload
    const result = tradingViewWebhookSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects invalid direction', () => {
    const result = tradingViewWebhookSchema.safeParse({ ...validPayload, direction: 'UP' })
    expect(result.success).toBe(false)
  })

  it('allows extra fields via passthrough', () => {
    const result = tradingViewWebhookSchema.safeParse({ ...validPayload, customField: 'extra' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as any).customField).toBe('extra')
    }
  })

  it('allows optional or_high/or_low to be missing', () => {
    const { or_high, or_low, timestamp, ...minimal } = validPayload
    const result = tradingViewWebhookSchema.safeParse(minimal)
    expect(result.success).toBe(true)
  })

  it('rejects price as string', () => {
    const result = tradingViewWebhookSchema.safeParse({ ...validPayload, price: '18450.25' })
    expect(result.success).toBe(false)
  })
})
