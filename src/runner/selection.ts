import type { Evaluator, SelectionResult } from '../providers/types.js'
import type {
  Decoy,
  DiscoveredSelectionFile,
  DiscoveredSkill,
  SelectionEval,
  SelectionFile,
  Variant,
} from '../types.js'
import { globMatch } from '../utils/glob-match.js'

export function buildSkillList(
  allSkills: readonly DiscoveredSkill[],
  skills: 'all' | string[],
  decoys: Decoy[],
): Array<{ name: string; description: string }> {
  const base =
    skills === 'all'
      ? allSkills.map(s => ({ name: s.name, description: s.description }))
      : allSkills
          .filter(s => skills.includes(s.name))
          .map(s => ({ name: s.name, description: s.description }))

  const decoyEntries = decoys.map(d => ({ name: d.name, description: d.value }))
  return [...base, ...decoyEntries]
}

function serializeAssert(assert: string[] | 'none' | 'any'): string {
  if (assert === 'none' || assert === 'any') return assert
  return assert.join(',')
}

export function evaluateResult(
  assert: string[] | 'none' | 'any',
  result: SelectionResult,
): boolean {
  if (assert === 'none' || (Array.isArray(assert) && assert.length === 0)) return !result.loaded
  if (assert === 'any') return result.loaded
  return result.loaded && result.skillName !== null && assert.includes(result.skillName)
}

export interface ProgressInfo {
  runIndex: number
  totalRuns: number
  evalName: string
  variantName?: string
  status: 'start' | 'complete'
  setup?: {
    prompt: string
    expected: string
    skills: Array<{ name: string; description: string }>
    timeoutMs: number
  }
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
  selectionFiles: readonly DiscoveredSelectionFile[]
  defaultModel?: string
  signal?: AbortSignal
  onProgress?: (info: ProgressInfo) => void
  onEvent?: (event: { type: string; [key: string]: unknown }) => void
  variantFilter?: string
  parallelism?: number
}

export interface EvalResult {
  eval: string
  passed: boolean
  expected: string
  actual: { loaded: boolean; skillName: string | null }
  durationMs: number
  variant?: string
  evalSkillName: string | null
  error?: string
}

export interface WorkItem {
  eval_: SelectionEval
  skillList: Array<{ name: string; description: string }>
  variantName: string
  skillName: string | null
  timeout: number
  assert: string[] | 'none' | 'any'
  model?: string
}

function resolveSkills(eval_: SelectionEval, file: SelectionFile): 'all' | string[] {
  return eval_.skills ?? file.skills
}

function resolveRunMode(
  eval_: SelectionEval,
  file: SelectionFile,
): 'all' | 'variants-only' | 'current-only' {
  return eval_['run-mode'] ?? file['run-mode']
}

function resolveTimeout(eval_: SelectionEval, file: SelectionFile): number {
  return eval_.timeout ?? file.timeout
}

function resolveModel(
  eval_: SelectionEval,
  file: SelectionFile,
  defaultModel?: string,
): string | undefined {
  return eval_.model ?? file.model ?? defaultModel
}

function resolveAssert(
  eval_: SelectionEval,
  skillName: string | null,
): (string[] | 'none' | 'any') | null {
  if (eval_.assert !== undefined) return eval_.assert
  if (skillName !== null) return [skillName]
  return null
}

function isStringArray(arr: readonly (string | Variant)[]): arr is string[] {
  return arr.length > 0 && typeof arr[0] === 'string'
}

function resolveVariants(eval_: SelectionEval, fileVariants: Variant[] | undefined): Variant[] {
  const ref = eval_.variants

  if (ref === 'all') {
    return (fileVariants ?? []).filter(v => v.enabled)
  }

  if (ref.length === 0) return []

  if (isStringArray(ref)) {
    const names = new Set(ref)
    const available = fileVariants ?? []
    const availableNames = new Set(available.map(v => v.name))
    for (const name of names) {
      if (!availableNames.has(name)) {
        console.error(`Warning: variant "${name}" referenced in eval "${eval_.name}" not found`)
      }
    }
    return available.filter(v => v.enabled && names.has(v.name))
  }

  return ref.filter(v => v.enabled)
}

function mergeDecoys(variantDecoys: Decoy[] | undefined, evalDecoys: Decoy[] | undefined): Decoy[] {
  const all = [...(variantDecoys ?? []), ...(evalDecoys ?? [])]
  const seen = new Set<string>()
  const result: Decoy[] = []
  for (const d of all) {
    if (d.enabled && !seen.has(d.name)) {
      seen.add(d.name)
      result.push(d)
    }
  }
  return result
}

/** Replaces the description of asserted skills with the variant's value. */
function applyVariantToSkillList(
  skillList: Array<{ name: string; description: string }>,
  assert: string[] | 'none' | 'any',
  variant: Variant,
): Array<{ name: string; description: string }> {
  if (assert === 'none' || assert === 'any') return skillList
  const assertSet = new Set(assert)
  return skillList.map(s => (assertSet.has(s.name) ? { ...s, description: variant.value } : s))
}

export function buildWorkItems(options: SelectionRunnerOptions): WorkItem[] {
  const { skills: allSkills, selectionFiles, variantFilter, defaultModel } = options
  const items: WorkItem[] = []

  for (const { file, skillName } of selectionFiles) {
    for (const eval_ of file.evals) {
      if (!eval_.enabled) continue

      const assert = resolveAssert(eval_, skillName)
      if (assert === null) {
        console.error(`Warning: skipping eval "${eval_.name}" — no assert and no skill context`)
        continue
      }

      const runMode = resolveRunMode(eval_, file)
      const resolvedSkills = resolveSkills(eval_, file)
      const timeout = resolveTimeout(eval_, file)
      const model = resolveModel(eval_, file, defaultModel)

      const shouldRunBase = runMode === 'all' || runMode === 'current-only'
      const shouldRunVariants = runMode === 'all' || runMode === 'variants-only'

      if (shouldRunBase) {
        if (!variantFilter || globMatch(variantFilter, 'base')) {
          const decoys = mergeDecoys(undefined, eval_.decoys)
          const skillList = buildSkillList(allSkills, resolvedSkills, decoys)
          items.push({ eval_, skillList, variantName: 'base', skillName, timeout, assert, model })
        }
      }

      if (shouldRunVariants) {
        const variants = resolveVariants(eval_, file.variants)
        for (const variant of variants) {
          if (variantFilter && !globMatch(variantFilter, variant.name)) continue
          const decoys = mergeDecoys(variant.decoys, eval_.decoys)
          const baseSkillList = buildSkillList(allSkills, resolvedSkills, decoys)
          const skillList = applyVariantToSkillList(baseSkillList, assert, variant)
          items.push({
            eval_,
            skillList,
            variantName: variant.name,
            skillName,
            timeout,
            assert,
            model,
          })
        }
      }
    }
  }

  return items
}

export async function runSingleEval(
  item: WorkItem,
  runIndex: number,
  totalRuns: number,
  options: Pick<SelectionRunnerOptions, 'evaluator' | 'signal' | 'onProgress' | 'onEvent'>,
): Promise<EvalResult> {
  const { evaluator, signal, onProgress, onEvent } = options
  const { eval_, skillList, variantName, skillName, timeout, assert, model } = item
  const serialized = serializeAssert(assert)
  const start = performance.now()

  onProgress?.({
    runIndex,
    totalRuns,
    evalName: eval_.name,
    variantName,
    status: 'start',
    setup: {
      prompt: eval_.prompt,
      expected: serialized,
      skills: skillList,
      timeoutMs: timeout * 1000,
    },
  })

  try {
    const canBailEarly = assert !== 'none' && assert !== 'any'

    const result = await evaluator.runSelection({
      prompt: eval_.prompt,
      skills: skillList,
      timeout: timeout * 1000,
      model,
      onEvent,
      signal,
      earlyBailout: canBailEarly,
    })
    const durationMs = performance.now() - start
    const passed = evaluateResult(assert, result)

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
      expected: serialized,
      actual: { loaded: result.loaded, skillName: result.skillName },
      durationMs,
      variant: variantName === 'base' ? undefined : variantName,
      evalSkillName: skillName,
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
      expected: serialized,
      actual: { loaded: false, skillName: null },
      durationMs,
      variant: variantName === 'base' ? undefined : variantName,
      evalSkillName: skillName,
      error,
    }
  }
}

export async function runSelectionEvals(options: SelectionRunnerOptions): Promise<EvalResult[]> {
  const { signal, parallelism = 1 } = options
  const items = buildWorkItems(options)
  const totalRuns = items.length
  const results: (EvalResult | undefined)[] = new Array(items.length)

  if (parallelism <= 1) {
    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) break
      results[i] = await runSingleEval(items[i], i, totalRuns, options)
    }
  } else {
    let nextIndex = 0

    async function runNext(): Promise<void> {
      while (nextIndex < items.length) {
        if (signal?.aborted) break
        const idx = nextIndex++
        results[idx] = await runSingleEval(items[idx], idx, totalRuns, options)
      }
    }

    const workers = Array.from({ length: Math.min(parallelism, items.length) }, () => runNext())
    await Promise.all(workers)
  }

  return results.filter((r): r is EvalResult => r !== undefined)
}
