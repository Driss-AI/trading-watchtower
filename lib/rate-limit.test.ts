import { describe, it, expect, beforeEach, vi } from 'vitest'
import { rateLimit, resetRateLimit } from './rate-limit'

beforeEach(() => {
  resetRateLimit()
  vi.useRealTimers()
})

describe('rateLimit', () => {
  it('allows requests under the limit', () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit('test', 5, 60_000).allowed).toBe(true)
    }
  })

  it('blocks requests over the limit', () => {
    for (let i = 0; i < 5; i++) {
      rateLimit('test', 5, 60_000)
    }
    expect(rateLimit('test', 5, 60_000).allowed).toBe(false)
  })

  it('treats different keys independently', () => {
    for (let i = 0; i < 5; i++) {
      rateLimit('key-a', 5, 60_000)
    }
    expect(rateLimit('key-a', 5, 60_000).allowed).toBe(false)
    expect(rateLimit('key-b', 5, 60_000).allowed).toBe(true)
  })

  it('resets after window expires', () => {
    vi.useFakeTimers()

    for (let i = 0; i < 5; i++) {
      rateLimit('test', 5, 1_000)
    }
    expect(rateLimit('test', 5, 1_000).allowed).toBe(false)

    vi.advanceTimersByTime(1_001)
    expect(rateLimit('test', 5, 1_000).allowed).toBe(true)
  })
})

describe('resetRateLimit', () => {
  it('clears a specific key', () => {
    for (let i = 0; i < 5; i++) {
      rateLimit('test', 5, 60_000)
    }
    expect(rateLimit('test', 5, 60_000).allowed).toBe(false)
    resetRateLimit('test')
    expect(rateLimit('test', 5, 60_000).allowed).toBe(true)
  })

  it('clears all keys when called without argument', () => {
    for (let i = 0; i < 5; i++) {
      rateLimit('a', 5, 60_000)
      rateLimit('b', 5, 60_000)
    }
    resetRateLimit()
    expect(rateLimit('a', 5, 60_000).allowed).toBe(true)
    expect(rateLimit('b', 5, 60_000).allowed).toBe(true)
  })
})
