const hits = new Map<string, number[]>()

export function rateLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean } {
  const now = Date.now()
  const timestamps = hits.get(key) ?? []
  const recent = timestamps.filter((t) => now - t < windowMs)

  if (recent.length >= maxRequests) {
    hits.set(key, recent)
    return { allowed: false }
  }

  recent.push(now)
  hits.set(key, recent)
  return { allowed: true }
}

export function resetRateLimit(key?: string) {
  if (key) hits.delete(key)
  else hits.clear()
}
