import { z } from 'zod/v4'
import { VariantConfigSchema, VariantSchema } from './variant.js'

const DecoySchema = z.object({
  name: z.string(),
  description: z.string(),
})

export const SelectionEvalSchema = z.object({
  name: z.string(),
  type: z.literal('selection'),
  prompt: z.string(),
  timeout_seconds: z.number().positive().optional().default(30),
  selection: z.object({
    expect: z.string(),
    available: z.union([z.literal('all'), z.array(z.string())]),
    decoys: z.array(DecoySchema).optional(),
  }),
  variants: z.array(VariantSchema).optional(),
  config: z
    .object({
      variants: VariantConfigSchema,
    })
    .optional(),
})

export const EvalSchema = z.discriminatedUnion('type', [SelectionEvalSchema])
