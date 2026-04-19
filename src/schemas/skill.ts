import { z } from 'zod/v4'

const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9]))*$/

export const SkillFrontmatterSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(
      SKILL_NAME_PATTERN,
      'Must be lowercase alphanumeric with single hyphens, not starting or ending with a hyphen',
    )
    .describe('Unique identifier for the skill. Lowercase alphanumeric with hyphens.'),
  description: z.string().min(1).max(1024).describe('Short description of what the skill does.'),
  license: z.string().optional().describe('SPDX license identifier for the skill.'),
  compatibility: z
    .string()
    .max(500)
    .optional()
    .describe('Compatibility notes (e.g. supported platforms or tools).'),
  metadata: z
    .record(z.string(), z.string())
    .optional()
    .describe('Arbitrary key-value metadata for the skill.'),
  'allowed-tools': z
    .string()
    .optional()
    .describe('Comma-separated list of tools the skill is allowed to use.'),
})
