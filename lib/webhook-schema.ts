import { z } from 'zod'

export const tradingViewWebhookSchema = z.object({
  secret: z.string(),
  symbol: z.string(),
  event: z.string(),
  direction: z.enum(['LONG', 'SHORT']),
  price: z.number(),
  or_high: z.number().optional(),
  or_low: z.number().optional(),
  timestamp: z.string().optional(),
}).passthrough()
