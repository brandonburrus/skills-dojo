import type { Evaluator, SelectionResult } from '../providers/types.js'
import type { DiscoveredEval, DiscoveredSkill, SelectionEval, Variant } from '../types.js'
import { globMatch } from '../utils/glob-match.js'

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
  /** 0-based index of the current run (across all evals and variants) */
  runIndex: number
  /** Total number of runs that will execute */
  totalRuns: number
  evalName: string
  variantName?: string
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
  /** Skill-level variants keyed by skill name */
  skillVariants?: Map<string, Variant[]>
  /** When set, only run the variant matching this name (or "base") */
  variantFilter?: string
  /** Max concurrent eval runs. Defaults to 1 (sequential). */
  parallelism?: number
}

export interface EvalResult {
  eval: string
  passed: boolean
  expected: string
  actual: { loaded: boolean; skillName: string | null }
  durationMs: number
  variant?: string
  /** The skill this eval belongs to (null for root-level evals) */
  evalSkillName: string | null
  error?: string
}

function resolveVariants(
  eval_: SelectionEval,
  skillVariants: Map<string, Variant[]> | undefined,
  skillName: string | null,
): Variant[] {
  const variantConfig = eval_.config?.variants ?? 'all'

  if (variantConfig === 'disabled') return []

  const inlineVariants = (eval_.variants ?? []).filter(v => v.enabled)

  if (variantConfig === 'inline-only') return inlineVariants

  // 'all' or 'variant-only': skill-level + inline
  const skillLevel = skillName ? (skillVariants?.get(skillName) ?? []).filter(v => v.enabled) : []
  const combined = [...skillLevel, ...inlineVariants]

  const seen = new Set<string>()
  for (const v of combined) {
    if (seen.has(v.name)) {
      console.error(`Warning: duplicate variant name "${v.name}" in eval "${eval_.name}"`)
    }
    seen.add(v.name)
  }

  return combined
}

/** Swaps the description of the expected skill in the skill list with the variant's description. */
function applyVariantToSkillList(
  skillList: Array<{ name: string; description: string }>,
  expectedSkill: string,
  variant: Variant,
): Array<{ name: string; description: string }> {
  return skillList.map(s =>
    s.name === expectedSkill ? { ...s, description: variant.description } : s,
  )
}

export async function runSingleEval(
  eval_: SelectionEval,
  skillList: Array<{ name: string; description: string }>,
  variantName: string,
  evalSkillName: string | null,
  runIndex: number,
  totalRuns: number,
  options: Pick<SelectionRunnerOptions, 'evaluator' | 'signal' | 'onProgress' | 'onEvent'>,
): Promise<EvalResult> {
  const { evaluator, signal, onProgress, onEvent } = options
  const start = performance.now()

  onProgress?.({
    runIndex,
    totalRuns,
    evalName: eval_.name,
    variantName,
    status: 'start',
    setup: {
      prompt: eval_.prompt,
      expected: eval_.selection.expect,
      skills: skillList,
      timeoutMs: eval_.timeout_seconds * 1000,
    },
  })

  try {
    const expected = eval_.selection.expect
    const canBailEarly = expected !== 'none' && expected !== 'any'

    const result = await evaluator.runSelection({
      prompt: eval_.prompt,
      skills: skillList,
      timeout: eval_.timeout_seconds * 1000,
      onEvent,
      signal,
      earlyBailout: canBailEarly,
    })
    const durationMs = performance.now() - start
    const passed = evaluateResult(eval_.selection.expect, result)

    onProgress?.({
      runIndex,
      totalRuns,
      evalName: eval_.name,
      variantName,
      status: 'complete',
      result: {
        passed,
        actual: { loaded: result.loaded, skillName: result.skillName },
        durationMs,
      },
    })

    return {
      eval: eval_.name,
      passed,
      expected: eval_.selection.expect,
      actual: { loaded: result.loaded, skillName: result.skillName },
      durationMs,
      variant: variantName === 'base' ? undefined : variantName,
      evalSkillName,
    }
  } catch (err) {
    const durationMs = performance.now() - start
    const isAbort = signal?.aborted || (err instanceof Error && err.message === 'Aborted')
    const error = isAbort ? 'Aborted' : err instanceof Error ? err.message : String(err)

    onProgress?.({
      runIndex,
      totalRuns,
      evalName: eval_.name,
      variantName,
      status: 'complete',
      result: {
        passed: false,
        actual: { loaded: false, skillName: null },
        durationMs,
        error,
      },
    })

    return {
      eval: eval_.name,
      passed: false,
      expected: eval_.selection.expect,
      actual: { loaded: false, skillName: null },
      durationMs,
      variant: variantName === 'base' ? undefined : variantName,
      evalSkillName,
      error,
    }
  }
}

export interface WorkItem {
  eval_: SelectionEval
  skillList: Array<{ name: string; description: string }>
  variantName: string
  skillName: string | null
}

function shouldRunBase(eval_: SelectionEval, variantFilter?: string): boolean {
  if (variantFilter && !globMatch(variantFilter, 'base')) return false
  const variantConfig = eval_.config?.variants ?? 'all'
  return variantConfig !== 'variant-only'
}

export function buildWorkItems(options: SelectionRunnerOptions): WorkItem[] {
  const { skills, evals, skillVariants, variantFilter } = options
  const items: WorkItem[] = []

  for (const { eval: eval_, skillName } of evals) {
    const baseSkillList = buildSkillList(skills, eval_)
    const expected = eval_.selection.expect

    if (shouldRunBase(eval_, variantFilter)) {
      items.push({ eval_, skillList: baseSkillList, variantName: 'base', skillName })
    }

    if (expected === 'none' || expected === 'any') continue

    const variants = resolveVariants(eval_, skillVariants, skillName)
    for (const variant of variants) {
      if (variantFilter && !globMatch(variantFilter, variant.name)) continue
      const variantSkillList = applyVariantToSkillList(baseSkillList, expected, variant)
      items.push({ eval_, skillList: variantSkillList, variantName: variant.name, skillName })
    }
  }

  return items
}

export async function runSelectionEvals(options: SelectionRunnerOptions): Promise<EvalResult[]> {
  const { signal, parallelism = 1 } = options
  const items = buildWorkItems(options)
  const totalRuns = items.length
  const results: (EvalResult | undefined)[] = new Array(items.length)

  if (parallelism <= 1) {
    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) break
      const item = items[i]
      results[i] = await runSingleEval(
        item.eval_,
        item.skillList,
        item.variantName,
        item.skillName,
        i,
        totalRuns,
        options,
      )
    }
  } else {
    let nextIndex = 0

    async function runNext(): Promise<void> {
      while (nextIndex < items.length) {
        if (signal?.aborted) break
        const idx = nextIndex++
        const item = items[idx]
        results[idx] = await runSingleEval(
          item.eval_,
          item.skillList,
          item.variantName,
          item.skillName,
          idx,
          totalRuns,
          options,
        )
      }
    }

    const workers = Array.from({ length: Math.min(parallelism, items.length) }, () => runNext())
    await Promise.all(workers)
  }

  return results.filter((r): r is EvalResult => r !== undefined)
}
