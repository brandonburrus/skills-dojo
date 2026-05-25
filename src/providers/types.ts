export interface SelectionResult {
  loaded: boolean
  skillName: string | null
  raw: string
}

export interface SelectionRunOptions {
  prompt: string
  skills: Array<{ name: string; description: string }>
  timeout: number
  model?: string
  onEvent?: (event: { type: string; [key: string]: unknown }) => void
  signal?: AbortSignal
  /** When set, abort the session as soon as any skill is loaded (skips remaining agent turns). */
  earlyBailout?: boolean
}

export interface EffectivenessRunOptions {
  prompt: string
  skillDirPath: string
  sandboxDir: string
  timeout: number
  model?: string
  signal?: AbortSignal
  onEvent?: (event: { type: string; [key: string]: unknown }) => void
}

export interface ToolCallRecord {
  tool: string
  input: unknown
  output: unknown
}

export interface EffectivenessResult {
  finalMessage: string
  toolCalls: ToolCallRecord[]
}

export interface Evaluator {
  runSelection(options: SelectionRunOptions): Promise<SelectionResult>
  runEffectiveness?(options: EffectivenessRunOptions): Promise<EffectivenessResult>
}

export interface FileDiff {
  path: string
  type: 'added' | 'modified' | 'deleted'
  content?: string
}

export interface JudgeCriterion {
  name: string
  threshold: number
}

export interface JudgeInput {
  prompt: string
  skillContent: string
  criteria: JudgeCriterion[]
  artifact: {
    finalMessage: string
    toolCalls: ToolCallRecord[]
    fsDiff: FileDiff[]
  }
  golden?: {
    files?: Array<{ path: string; content: string }>
    notes?: string
  }
}

export interface CriterionResult {
  name: string
  score: number
  passed: boolean
  reasoning: string
}

export interface JudgeResult {
  perCriterion: CriterionResult[]
  overallPassed: boolean
  judgeModel: string
}

export interface Judge {
  evaluate(input: JudgeInput): Promise<JudgeResult>
}
