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

export const SUPPORTED_PROVIDERS = ['copilot', 'openai', 'anthropic', 'vercel'] as const

const ModelSectionSchema = z.object({
  provider: z
    .enum(SUPPORTED_PROVIDERS)
    .default('anthropic')
    .describe(
      'Model provider to use for evaluations. One of: copilot, openai, anthropic, vercel. Defaults to anthropic.',
    ),
  evaluator: z
    .string()
    .optional()
    .describe(
      'Model to use for running evals. Defaults to the provider\'s default model. For the vercel provider, use the form "<underlying-provider>/<model-id>" (e.g. "openai/gpt-4o-mini").',
    ),
  judge: z
    .string()
    .optional()
    .describe("Model to use for judging eval results. Defaults to the provider's default model."),
})

const EffectivenessSectionSchema = z.object({
  warnFixtureThreshold: z
    .number()
    .positive()
    .optional()
    .default(4)
    .describe('Print a warning when a skill has more fixtures than this.'),
  confirmFixtureThreshold: z
    .number()
    .positive()
    .optional()
    .default(12)
    .describe('Require --yes confirmation when a skill has more fixtures than this.'),
})

const ReportingSectionSchema = z.object({
  perSkill: z
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
  effectiveness: EffectivenessSectionSchema.default(() =>
    EffectivenessSectionSchema.parse({}),
  ).describe('Configuration for effectiveness evals.'),
  reporting: ReportingSectionSchema.default(() => ReportingSectionSchema.parse({})).describe(
    'Controls how and where eval reports are written.',
  ),
})

export type DojoConfig = z.infer<typeof DojoConfigSchema>

export const DEFAULT_CONFIG: DojoConfig = DojoConfigSchema.parse({})
