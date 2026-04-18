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
    ),
  description: z.string().min(1).max(1024),
  license: z.string().optional(),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  'allowed-tools': z.string().optional(),
})
