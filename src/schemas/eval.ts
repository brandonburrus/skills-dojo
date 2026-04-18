import { z } from 'zod/v4'

export const DecoySchema = z.object({
  name: z.string(),
  value: z.string(),
  enabled: z.boolean().optional().default(true),
})

export const VariantSchema = z.object({
  name: z.string().min(1).max(100),
  value: z.string().min(1).max(10000),
  enabled: z.boolean().optional().default(true),
  decoys: z.array(DecoySchema).optional(),
})

const RunModeSchema = z.enum(['all', 'variants-only', 'current-only'])

const VariantsRefSchema = z.union([z.literal('all'), z.array(z.string()), z.array(VariantSchema)])

export const SelectionEvalSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  model: z.string().optional(),
  timeout: z.number().positive().optional(),
  enabled: z.boolean().optional().default(true),
  skills: z.union([z.literal('all'), z.array(z.string())]).optional(),
  'run-mode': RunModeSchema.optional(),
  assert: z.union([z.array(z.string()), z.literal('none'), z.literal('any')]).optional(),
  variants: VariantsRefSchema.optional().default('all'),
  decoys: z.array(DecoySchema).optional(),
})

export const SelectionFileSchema = z.object({
  model: z.string().optional(),
  timeout: z.number().positive().optional().default(30),
  skills: z
    .union([z.literal('all'), z.array(z.string())])
    .optional()
    .default('all'),
  'run-mode': RunModeSchema.optional().default('all'),
  variants: z.array(VariantSchema).optional(),
  evals: z.array(SelectionEvalSchema),
})
