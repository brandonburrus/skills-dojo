import { z } from 'zod/v4'

export const VariantSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(10000),
  enabled: z.boolean().optional().default(true),
})

export const VariantConfigSchema = z
  .enum(['all', 'inline-only', 'variant-only', 'disabled'])
  .default('all')
