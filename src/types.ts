import type { z } from 'zod/v4'
import type { DojoConfigSchema } from './schemas/config.js'
import type { RunReportSchema } from './schemas/report.js'
import type {
  CriterionSchema,
  DecoySchema,
  EffectivenessEvalSchema,
  EffectivenessFileSchema,
  MatrixEntrySchema,
  RunModeSchema,
  SelectionEvalSchema,
  SelectionFileSchema,
  VariantSchema,
} from './schemas/eval.js'
import type { SkillFrontmatterSchema } from './schemas/skill.js'

export type DojoConfig = z.infer<typeof DojoConfigSchema>
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>
export type RunReport = z.infer<typeof RunReportSchema>

export type Variant = z.infer<typeof VariantSchema>
export type Decoy = z.infer<typeof DecoySchema>
export type SelectionEval = z.infer<typeof SelectionEvalSchema>
export type SelectionFile = z.infer<typeof SelectionFileSchema>

export type EffectivenessEval = z.infer<typeof EffectivenessEvalSchema>
export type EffectivenessFile = z.infer<typeof EffectivenessFileSchema>
export type Criterion = z.infer<typeof CriterionSchema>
export type MatrixEntry = z.infer<typeof MatrixEntrySchema>
export type RunMode = z.infer<typeof RunModeSchema>

export interface DiscoveredSkill {
  name: string
  description: string
  dirPath: string
  frontmatter: SkillFrontmatter
}

export interface DiscoveredSelectionFile {
  filePath: string
  skillName: string | null
  file: SelectionFile
}

export interface DiscoveredEffectivenessFile {
  filePath: string
  skillName: string | null
  file: EffectivenessFile
}

export interface DiscoveredFixture {
  name: string
  testsDir: string
  goldenDir?: string
}

export interface DiscoveredVariant {
  name: string
  dirPath: string
  description: string
}

export interface GlobalOptions {
  cwd?: string
  config?: string
  skillsDir?: string[]
}
