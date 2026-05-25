import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod/v4'
import type { Judge, JudgeInput, EffectivenessResult } from '../providers/types.js'
import type {
  DiscoveredEffectivenessFile,
  DiscoveredFixture,
  DiscoveredSkill,
  EffectivenessEval,
  EffectivenessFile,
  MatrixEntry,
  Variant,
} from '../types.js'
import {
  createSandbox,
  runSetup,
  finalizeSandbox,
  cleanupSandbox,
  type SandboxOptions,
} from './sandbox/harness.js'

const ArtifactSchema = z.object({
  finalMessage: z.string(),
  toolCalls: z.array(
    z.object({
      tool: z.string(),
      input: z.unknown(),
      output: z.unknown(),
    }),
  ),
})

export interface EffectivenessAgentWorkItem {
  eval_: EffectivenessEval
  fixture: DiscoveredFixture
  evaluator: MatrixEntry
  judges: MatrixEntry[]
  skillName: string | null
  skillDirPath: string
  timeout: number
  variantName: string
  /** For 'base' variant: path to SKILL.md. For other variants: inline skill content. */
  variantSkillContent: string
}

export interface EffectivenessEvalResult {
  eval: string
  fixture: string
  evaluator: string
  judge: string
  variant?: string
  skillName: string | null
  passed: boolean
  criteria: Array<{ name: string; score: number; passed: boolean; reasoning: string }>
  durationMs: number
  error?: string
}

export interface EffectivenessProgressInfo {
  runIndex: number
  totalRuns: number
  evalName: string
  fixtureName: string
  evaluatorId: string
  status: 'start' | 'complete'
  result?: { passed: boolean; durationMs: number; error?: string }
}

export interface EffectivenessRunnerOptions {
  skills: readonly DiscoveredSkill[]
  effectivenessFiles: readonly DiscoveredEffectivenessFile[]
  fixtures: ReadonlyMap<string, DiscoveredFixture[]>
  judges: Map<string, Judge>
  runId: string
  signal?: AbortSignal
  onProgress?: (info: EffectivenessProgressInfo) => void
  defaultTimeout?: number
  parallelism?: number
  keepSandbox?: boolean
  /** Fallback matrix derived from global config when YAML doesn't specify one. */
  defaultMatrix?: { evaluators: MatrixEntry[]; judges: MatrixEntry[] }
}

function formatMatrixEntry(entry: MatrixEntry): string {
  return `${entry.provider}/${entry.model}`
}

function isStringArray(arr: readonly (string | Variant)[]): arr is string[] {
  return arr.length > 0 && typeof arr[0] === 'string'
}

function resolveVariants(eval_: EffectivenessEval, fileVariants: Variant[] | undefined): Variant[] {
  const ref = eval_.variants

  if (ref === 'all') {
    return (fileVariants ?? []).filter(v => v.enabled)
  }

  if (ref.length === 0) return []

  if (isStringArray(ref)) {
    const names = new Set(ref)
    const available = fileVariants ?? []
    return available.filter(v => v.enabled && names.has(v.name))
  }

  return ref.filter(v => v.enabled)
}

function resolveMatrix(
  eval_: EffectivenessEval,
  file: EffectivenessFile,
  defaultMatrix?: { evaluators: MatrixEntry[]; judges: MatrixEntry[] },
): { evaluators: MatrixEntry[]; judges: MatrixEntry[] } {
  const matrix = eval_.matrix ?? file.defaults?.matrix
  return {
    evaluators: matrix?.evaluators ?? defaultMatrix?.evaluators ?? [],
    judges: matrix?.judges ?? defaultMatrix?.judges ?? [],
  }
}

export function buildEffectivenessWorkItems(
  options: EffectivenessRunnerOptions,
): EffectivenessAgentWorkItem[] {
  const { effectivenessFiles, fixtures, skills, defaultMatrix } = options
  const items: EffectivenessAgentWorkItem[] = []

  for (const { file, skillName } of effectivenessFiles) {
    if (skillName === null) continue

    const skill = skills.find(s => s.name === skillName)
    if (!skill) continue

    const skillFixtures = fixtures.get(skillName) ?? []
    const skillContentPath = path.join(skill.dirPath, 'SKILL.md')

    for (const eval_ of file.evals) {
      if (!eval_.enabled) continue

      const { evaluators, judges } = resolveMatrix(eval_, file, defaultMatrix)
      if (evaluators.length === 0 || judges.length === 0) continue

      const evalFixtures =
        eval_.fixtures != null
          ? skillFixtures.filter(f => eval_.fixtures!.includes(f.name))
          : skillFixtures

      if (evalFixtures.length === 0) continue

      const timeout = eval_.timeout ?? file.timeout
      const variants = resolveVariants(eval_, file.variants)

      for (const fixture of evalFixtures) {
        for (const evaluator of evaluators) {
          // Base run
          items.push({
            eval_,
            fixture,
            evaluator,
            judges,
            skillName,
            skillDirPath: skill.dirPath,
            timeout,
            variantName: 'base',
            variantSkillContent: skillContentPath,
          })

          // Variant runs
          for (const variant of variants) {
            items.push({
              eval_,
              fixture,
              evaluator,
              judges,
              skillName,
              skillDirPath: skill.dirPath,
              timeout,
              variantName: variant.name,
              variantSkillContent: variant.value,
            })
          }
        }
      }
    }
  }

  return items
}

async function readSkillContent(skillDirPath: string): Promise<string> {
  const skillMdPath = path.join(skillDirPath, 'SKILL.md')
  return readFile(skillMdPath, 'utf-8')
}

async function readGoldenReference(
  fixture: DiscoveredFixture,
): Promise<JudgeInput['golden'] | undefined> {
  if (!fixture.goldenDir) return undefined

  let notes: string | undefined
  const notesPath = path.join(fixture.goldenDir, 'notes.md')
  try {
    notes = await readFile(notesPath, 'utf-8')
  } catch {
    // notes.md is optional
  }

  let files: Array<{ path: string; content: string }> | undefined
  const filesDir = path.join(fixture.goldenDir, 'files')
  try {
    const entries = await readdir(filesDir, { recursive: true })
    files = []
    for (const entry of entries) {
      const fullPath = path.join(filesDir, entry)
      const stat = await import('node:fs/promises').then(fs => fs.stat(fullPath))
      if (!stat.isFile()) continue
      const content = await readFile(fullPath, 'utf-8')
      files.push({ path: entry, content })
    }
    if (files.length === 0) files = undefined
  } catch {
    // files/ dir is optional
  }

  if (!notes && !files) return undefined
  return { notes, files }
}

function spawnAgent(
  item: EffectivenessAgentWorkItem,
  sandbox: { workspaceDir: string; skillDir: string },
  signal?: AbortSignal,
): Promise<EffectivenessResult> {
  return new Promise((resolve, reject) => {
    const dir = import.meta.dirname ?? ''
    const tsPath = path.resolve(dir, 'sandbox', 'agent-runner.ts')
    const jsPath = path.resolve(dir, 'sandbox', 'agent-runner.js')
    const bundledJsPath = path.resolve(dir, 'runner', 'sandbox', 'agent-runner.js')

    let agentRunnerPath: string
    let command: string
    let args: string[]

    if (existsSync(tsPath)) {
      agentRunnerPath = tsPath
      command = 'npx'
      args = ['tsx', agentRunnerPath]
    } else if (existsSync(jsPath)) {
      agentRunnerPath = jsPath
      command = 'node'
      args = [agentRunnerPath]
    } else if (existsSync(bundledJsPath)) {
      agentRunnerPath = bundledJsPath
      command = 'node'
      args = [agentRunnerPath]
    } else {
      reject(new Error(`Cannot find agent-runner at ${tsPath} or ${jsPath} or ${bundledJsPath}`))
      return
    }

    const artifactPath = path.join(sandbox.workspaceDir, '.dojo-artifact.json')

    const child = spawn(command, args, {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        DOJO_SANDBOX_DIR: sandbox.workspaceDir,
        DOJO_SKILL_DIR: sandbox.skillDir,
        DOJO_PROMPT: item.eval_.prompt,
        DOJO_PROVIDER: item.evaluator.provider,
        DOJO_MODEL: item.evaluator.model,
        DOJO_ARTIFACT_PATH: artifactPath,
        DOJO_TIMEOUT: String(item.timeout * 1000),
      },
      cwd: sandbox.workspaceDir,
      stdio: 'pipe',
      signal,
    })

    const killTimeout = setTimeout(
      () => {
        child.kill('SIGTERM')
      },
      item.timeout * 1000 + 5000,
    )
    killTimeout.unref()

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdout?.on('data', () => {})

    child.on('error', (err: Error) => {
      clearTimeout(killTimeout)
      reject(err)
    })

    child.on('close', async (code: number | null) => {
      clearTimeout(killTimeout)
      if (code !== 0) {
        reject(new Error(`Agent process exited with code ${code}: ${stderr}`))
        return
      }

      try {
        const raw = await readFile(artifactPath, 'utf-8')
        const artifact = ArtifactSchema.parse(JSON.parse(raw))
        resolve(artifact as EffectivenessResult)
      } catch (err) {
        reject(
          new Error(
            `Failed to read agent artifact: ${err instanceof Error ? err.message : String(err)}`,
          ),
        )
      }
    })
  })
}

export async function runSingleEffectivenessEval(
  item: EffectivenessAgentWorkItem,
  runIndex: number,
  totalRuns: number,
  options: Pick<
    EffectivenessRunnerOptions,
    'judges' | 'signal' | 'onProgress' | 'runId' | 'keepSandbox'
  >,
): Promise<EffectivenessEvalResult[]> {
  const { judges, signal, onProgress, runId, keepSandbox } = options
  const evaluatorId = formatMatrixEntry(item.evaluator)
  const start = performance.now()

  onProgress?.({
    runIndex,
    totalRuns,
    evalName: item.eval_.name,
    fixtureName: item.fixture.name,
    evaluatorId,
    status: 'start',
  })

  try {
    const sandboxOptions: SandboxOptions = {
      runId,
      skillName: item.skillName ?? 'unknown',
      fixtureName: item.fixture.name,
      skillDirPath: item.skillDirPath,
      fixtureTestsDir: item.fixture.testsDir,
      evaluatorId,
      sample: runIndex,
    }

    const sandbox = await createSandbox(sandboxOptions)

    try {
      await runSetup(sandbox, signal)
      const artifact = await spawnAgent(item, sandbox, signal)
      const { fsDiff } = await finalizeSandbox(sandbox)

      // Resolve skill content: for 'base' variant read from disk, for variants use inline value
      const skillContent =
        item.variantName === 'base'
          ? await readSkillContent(item.skillDirPath)
          : item.variantSkillContent

      const golden = await readGoldenReference(item.fixture)
      const durationMs = performance.now() - start

      const results: EffectivenessEvalResult[] = []

      for (const judgeEntry of item.judges) {
        const judgeId = formatMatrixEntry(judgeEntry)
        const judgeInstance = judges.get(judgeId)

        if (!judgeInstance) {
          results.push({
            eval: item.eval_.name,
            fixture: item.fixture.name,
            evaluator: evaluatorId,
            judge: judgeId,
            variant: item.variantName === 'base' ? undefined : item.variantName,
            skillName: item.skillName,
            passed: false,
            criteria: [],
            durationMs,
            error: `Judge "${judgeId}" not found in provided judges map`,
          })
          continue
        }

        const judgeInput: JudgeInput = {
          prompt: item.eval_.prompt,
          skillContent,
          criteria: item.eval_.criteria.map(c => ({
            name: c.name,
            description: c.description,
            threshold: c.pass_threshold,
          })),
          artifact: {
            finalMessage: artifact.finalMessage,
            toolCalls: artifact.toolCalls,
            fsDiff,
          },
          golden,
        }

        try {
          const judgeResult = await judgeInstance.evaluate(judgeInput)

          results.push({
            eval: item.eval_.name,
            fixture: item.fixture.name,
            evaluator: evaluatorId,
            judge: judgeId,
            variant: item.variantName === 'base' ? undefined : item.variantName,
            skillName: item.skillName,
            passed: judgeResult.overallPassed,
            criteria: judgeResult.perCriterion.map(c => ({
              name: c.name,
              score: c.score,
              passed: c.passed,
              reasoning: c.reasoning,
            })),
            durationMs,
          })
        } catch (err) {
          results.push({
            eval: item.eval_.name,
            fixture: item.fixture.name,
            evaluator: evaluatorId,
            judge: judgeId,
            variant: item.variantName === 'base' ? undefined : item.variantName,
            skillName: item.skillName,
            passed: false,
            criteria: [],
            durationMs,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      onProgress?.({
        runIndex,
        totalRuns,
        evalName: item.eval_.name,
        fixtureName: item.fixture.name,
        evaluatorId,
        status: 'complete',
        result: { passed: results.every(r => r.passed), durationMs },
      })

      return results
    } finally {
      if (!keepSandbox) {
        await cleanupSandbox(sandbox)
      }
    }
  } catch (err) {
    const durationMs = performance.now() - start
    const isAbort = signal?.aborted || (err instanceof Error && err.message === 'Aborted')
    const error = isAbort ? 'Aborted' : err instanceof Error ? err.message : String(err)

    onProgress?.({
      runIndex,
      totalRuns,
      evalName: item.eval_.name,
      fixtureName: item.fixture.name,
      evaluatorId,
      status: 'complete',
      result: { passed: false, durationMs, error },
    })

    return item.judges.map(judgeEntry => ({
      eval: item.eval_.name,
      fixture: item.fixture.name,
      evaluator: evaluatorId,
      judge: formatMatrixEntry(judgeEntry),
      variant: item.variantName === 'base' ? undefined : item.variantName,
      skillName: item.skillName,
      passed: false,
      criteria: [],
      durationMs,
      error,
    }))
  }
}

const CONSECUTIVE_FAILURE_ABORT_THRESHOLD = 3

export async function runEffectivenessEvals(
  options: EffectivenessRunnerOptions,
): Promise<EffectivenessEvalResult[]> {
  const { signal, parallelism = 1 } = options
  const items = buildEffectivenessWorkItems(options)
  const totalRuns = items.length
  const results: EffectivenessEvalResult[][] = new Array(items.length)

  if (parallelism <= 1) {
    let consecutiveErrors = 0
    let lastErrorMessage: string | undefined

    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) break
      results[i] = await runSingleEffectivenessEval(items[i], i, totalRuns, options)

      const resultErrors = results[i].filter(r => r.error)
      if (resultErrors.length > 0 && resultErrors.length === results[i].length) {
        const errorMsg = resultErrors[0].error
        if (errorMsg === lastErrorMessage) {
          consecutiveErrors++
        } else {
          consecutiveErrors = 1
          lastErrorMessage = errorMsg
        }

        if (consecutiveErrors >= CONSECUTIVE_FAILURE_ABORT_THRESHOLD) {
          for (let j = i + 1; j < items.length; j++) {
            results[j] = items[j].judges.map(judgeEntry => ({
              eval: items[j].eval_.name,
              fixture: items[j].fixture.name,
              evaluator: formatMatrixEntry(items[j].evaluator),
              judge: formatMatrixEntry(judgeEntry),
              variant: items[j].variantName === 'base' ? undefined : items[j].variantName,
              skillName: items[j].skillName,
              passed: false,
              criteria: [],
              durationMs: 0,
              error: `Aborted: ${consecutiveErrors} consecutive failures with same error: ${lastErrorMessage}`,
            }))
          }
          break
        }
      } else {
        consecutiveErrors = 0
        lastErrorMessage = undefined
      }
    }
  } else {
    let nextIndex = 0

    async function runNext(): Promise<void> {
      while (nextIndex < items.length) {
        if (signal?.aborted) break
        const idx = nextIndex++
        results[idx] = await runSingleEffectivenessEval(items[idx], idx, totalRuns, options)
      }
    }

    const workers = Array.from({ length: Math.min(parallelism, items.length) }, () => runNext())
    await Promise.all(workers)
  }

  return results.filter((r): r is EffectivenessEvalResult[] => r !== undefined).flat()
}
