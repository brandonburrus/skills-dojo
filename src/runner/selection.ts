import type { Evaluator, SelectionResult } from '../providers/types.js'
import type { DiscoveredEval, DiscoveredSkill, SelectionEval } from '../types.js'

export function buildSkillList(
  allSkills: readonly DiscoveredSkill[],
  eval_: SelectionEval,
): Array<{ name: string; description: string }> {
  const { available, decoys } = eval_.selection

  const skills =
    available === 'all'
      ? allSkills.map(s => ({ name: s.name, description: s.description }))
      : allSkills
          .filter(s => available.includes(s.name))
          .map(s => ({ name: s.name, description: s.description }))

  return decoys ? [...skills, ...decoys] : [...skills]
}

export function evaluateResult(expected: string, result: SelectionResult): boolean {
  if (expected === 'none') return !result.loaded
  if (expected === 'any') return result.loaded
  return result.loaded && result.skillName === expected
}

export interface ProgressInfo {
  evalIndex: number
  totalEvals: number
  evalName: string
  status: 'start' | 'complete'
  /** Available on 'start' — details about what's being set up */
  setup?: {
    prompt: string
    expected: string
    skills: Array<{ name: string; description: string }>
    timeoutMs: number
  }
  /** Available on 'complete' */
  result?: {
    passed: boolean
    actual: { loaded: boolean; skillName: string | null }
    durationMs: number
    error?: string
  }
}

export interface SelectionRunnerOptions {
  evaluator: Evaluator
  skills: readonly DiscoveredSkill[]
  evals: readonly DiscoveredEval[]
  signal?: AbortSignal
  onProgress?: (info: ProgressInfo) => void
  onEvent?: (event: { type: string; [key: string]: unknown }) => void
}

export interface EvalResult {
  eval: string
  passed: boolean
  expected: string
  actual: { loaded: boolean; skillName: string | null }
  durationMs: number
  error?: string
}

export async function runSelectionEvals(options: SelectionRunnerOptions): Promise<EvalResult[]> {
  const { evaluator, skills, evals, signal, onProgress, onEvent } = options
  const results: EvalResult[] = []

  for (let i = 0; i < evals.length; i++) {
    if (signal?.aborted) break

    const { eval: eval_ } = evals[i]
    const skillList = buildSkillList(skills, eval_)
    const start = performance.now()

    onProgress?.({
      evalIndex: i,
      totalEvals: evals.length,
      evalName: eval_.name,
      status: 'start',
      setup: {
        prompt: eval_.prompt,
        expected: eval_.selection.expect,
        skills: skillList,
        timeoutMs: eval_.timeout_seconds * 1000,
      },
    })

    try {
      const result = await evaluator.runSelection({
        prompt: eval_.prompt,
        skills: skillList,
        timeout: eval_.timeout_seconds * 1000,
        onEvent,
        signal,
      })
      const durationMs = performance.now() - start
      const passed = evaluateResult(eval_.selection.expect, result)

      results.push({
        eval: eval_.name,
        passed,
        expected: eval_.selection.expect,
        actual: { loaded: result.loaded, skillName: result.skillName },
        durationMs,
      })

      onProgress?.({
        evalIndex: i,
        totalEvals: evals.length,
        evalName: eval_.name,
        status: 'complete',
        result: {
          passed,
          actual: { loaded: result.loaded, skillName: result.skillName },
          durationMs,
        },
      })
    } catch (err) {
      const durationMs = performance.now() - start
      const isAbort = signal?.aborted || (err instanceof Error && err.message === 'Aborted')
      const error = isAbort ? 'Aborted' : err instanceof Error ? err.message : String(err)

      results.push({
        eval: eval_.name,
        passed: false,
        expected: eval_.selection.expect,
        actual: { loaded: false, skillName: null },
        durationMs,
        error,
      })

      onProgress?.({
        evalIndex: i,
        totalEvals: evals.length,
        evalName: eval_.name,
        status: 'complete',
        result: {
          passed: false,
          actual: { loaded: false, skillName: null },
          durationMs,
          error,
        },
      })
    }
  }

  return results
}
