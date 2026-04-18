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
  dir: z.union([z.string(), z.array(z.string())]).default(DEFAULT_SKILL_DIRS),
})

const ModelSectionSchema = z.object({
  provider: z.string().default('copilot'),
  evaluator: z.string().optional(),
  judge: z.string().optional(),
})

const ReportingSectionSchema = z.object({
  'per-skill': z.boolean().default(true),
  consolidated: z.boolean().default(false),
})

export const DojoConfigSchema = z.object({
  skills: SkillsSectionSchema.default(() => SkillsSectionSchema.parse({})),
  model: ModelSectionSchema.default(() => ModelSectionSchema.parse({})),
  reporting: ReportingSectionSchema.default(() => ReportingSectionSchema.parse({})),
})

export type DojoConfig = z.infer<typeof DojoConfigSchema>

export const DEFAULT_CONFIG: DojoConfig = DojoConfigSchema.parse({})
