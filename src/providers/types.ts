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

export interface Evaluator {
  runSelection(options: SelectionRunOptions): Promise<SelectionResult>
}

export interface JudgeResult {
  score: number
  passed: boolean
  reasoning: string
}

export interface Judge {
  score(options: { criteria: string; content: string; threshold: number }): Promise<JudgeResult>
}
