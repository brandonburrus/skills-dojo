import type { z } from 'zod/v4'
import type { DojoConfigSchema } from './schemas/config.js'
import type { RunReportSchema } from './schemas/report.js'
import type { EvalSchema, SelectionEvalSchema } from './schemas/eval.js'
import type { SkillFrontmatterSchema } from './schemas/skill.js'

export type DojoConfig = z.infer<typeof DojoConfigSchema>
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>
export type SelectionEval = z.infer<typeof SelectionEvalSchema>
export type Eval = z.infer<typeof EvalSchema>
export type RunReport = z.infer<typeof RunReportSchema>

export interface DiscoveredSkill {
  name: string
  description: string
  dirPath: string
  frontmatter: SkillFrontmatter
}

export interface DiscoveredEval {
  filePath: string
  eval: SelectionEval
  skillName: string | null
}
