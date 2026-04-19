import { z } from 'zod/v4'

export const DecoySchema = z.object({
  name: z.string().describe('Name of the decoy skill.'),
  value: z.string().describe('SKILL.md content for the decoy skill.'),
  enabled: z.boolean().optional().default(true).describe('Whether this decoy is active.'),
})

export const VariantSchema = z.object({
  name: z.string().min(1).max(100).describe('Unique name for this variant.'),
  value: z
    .string()
    .min(1)
    .max(10000)
    .describe('SKILL.md content to use in place of the current skill content.'),
  enabled: z.boolean().optional().default(true).describe('Whether this variant is active.'),
  decoys: z.array(DecoySchema).optional().describe('Decoy skills specific to this variant.'),
})

const RunModeSchema = z.enum(['all', 'variants-only', 'current-only'])

const VariantsRefSchema = z.union([z.literal('all'), z.array(z.string()), z.array(VariantSchema)])

export const SelectionEvalSchema = z.object({
  name: z.string().describe('Unique name for this eval.'),
  prompt: z.string().describe('The prompt to send to the agent being evaluated.'),
  model: z.string().optional().describe('Override the model for this eval.'),
  timeout: z
    .number()
    .positive()
    .optional()
    .describe('Timeout in seconds for this eval. Overrides the file-level timeout.'),
  enabled: z.boolean().optional().default(true).describe('Whether this eval is active.'),
  skills: z
    .union([z.literal('all'), z.array(z.string())])
    .optional()
    .describe('Skills to register for this eval. Use "all" or a list of skill names.'),
  'run-mode': RunModeSchema.optional().describe(
    'Controls which runs to perform: "all" runs current + variants, "variants-only" skips current, "current-only" skips variants.',
  ),
  assert: z
    .union([z.array(z.string()), z.literal('none'), z.literal('any')])
    .optional()
    .describe(
      'Expected skill selection. An array of skill names, "none" if no skill should load, or "any" to accept any selection. Defaults to the owning skill for skill-scoped evals.',
    ),
  variants: VariantsRefSchema.optional()
    .default('all')
    .describe('Variants to run: "all" uses file-level variants, or specify inline/by name.'),
  decoys: z
    .array(DecoySchema)
    .optional()
    .describe('Decoy skills to register alongside real skills for this eval.'),
})

export const SelectionFileSchema = z.object({
  model: z.string().optional().describe('Default model for all evals in this file.'),
  timeout: z
    .number()
    .positive()
    .optional()
    .default(30)
    .describe('Default timeout in seconds for evals in this file.'),
  skills: z
    .union([z.literal('all'), z.array(z.string())])
    .optional()
    .default('all')
    .describe('Skills to register for evals. Use "all" or a list of skill names.'),
  'run-mode': RunModeSchema.optional()
    .default('all')
    .describe('Default run mode for evals: "all", "variants-only", or "current-only".'),
  variants: z
    .array(VariantSchema)
    .optional()
    .describe('Variant definitions available to evals in this file.'),
  evals: z.array(SelectionEvalSchema).describe('List of selection evals to run.'),
})
