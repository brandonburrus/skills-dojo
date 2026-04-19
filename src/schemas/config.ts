import { z } from 'zod/v4'

const DEFAULT_SKILL_DIRS = [
  'skills',
  '.agents/skills',
  '.github/skills',
  '.claude/skills',
  '.codex/skills',
  '.gemini/skills',
  '.openclaw/skills',
  '.opencode/skills',
]

const SkillsSectionSchema = z.object({
  dir: z
    .union([z.string(), z.array(z.string())])
    .default(DEFAULT_SKILL_DIRS)
    .describe(
      'Directories to search for SKILL.md files. Can be a single path or an array of paths.',
    ),
})

const ModelSectionSchema = z.object({
  provider: z
    .string()
    .default('copilot')
    .describe('Model provider to use for evaluations. Currently only "copilot" is supported.'),
  evaluator: z
    .string()
    .optional()
    .describe("Model to use for running evals. Defaults to the provider's default model."),
  judge: z
    .string()
    .optional()
    .describe("Model to use for judging eval results. Defaults to the provider's default model."),
})

const ReportingSectionSchema = z.object({
  'per-skill': z
    .boolean()
    .default(true)
    .describe('Write a separate report for each skill under its evals/reports/ directory.'),
  consolidated: z
    .boolean()
    .default(false)
    .describe('Write a single consolidated report combining all skills.'),
})

export const DojoConfigSchema = z.object({
  skills: SkillsSectionSchema.default(() => SkillsSectionSchema.parse({})).describe(
    'Configuration for skill discovery.',
  ),
  model: ModelSectionSchema.default(() => ModelSectionSchema.parse({})).describe(
    'Model provider and model selection for evaluations.',
  ),
  reporting: ReportingSectionSchema.default(() => ReportingSectionSchema.parse({})).describe(
    'Controls how and where eval reports are written.',
  ),
})

export type DojoConfig = z.infer<typeof DojoConfigSchema>

export const DEFAULT_CONFIG: DojoConfig = DojoConfigSchema.parse({})
