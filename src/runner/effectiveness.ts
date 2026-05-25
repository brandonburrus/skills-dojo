import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod/v4'
import type { Judge, JudgeInput, EffectivenessResult } from '../providers/types.js'
import type {
  DiscoveredEffectivenessFile,
  DiscoveredFixture,
  DiscoveredSkill,
  DiscoveredVariant,
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
  /** Path to the variant skill directory (canonical skill dir for 'current', variant dir for filesystem variants). */
  variantSkillDir: string
  /** For inline variants: the full SKILL.md content to write into the sandbox. */
  inlineSkillContent?: string
}

export interface EffectivenessEvalResult {
  eval: string
  fixture: string
  evaluator: string
  judge: string
  variant: string
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
  /** Discovered filesystem variants per skill (keyed by skill name). */
  discoveredVariants?: ReadonlyMap<string, DiscoveredVariant[]>
}

interface ResolvedVariant {
  name: string
  /** For inline variants, null. For filesystem variants, the variant dir path. */
  dirPath: string | null
  /** For inline variants only: the SKILL.md body content. */
  inlineContent: string | null
}

function formatMatrixEntry(entry: MatrixEntry): string {
  return `${entry.provider}/${entry.model}`
}

function isStringArray(arr: readonly (string | Variant)[]): arr is string[] {
  return arr.length > 0 && typeof arr[0] === 'string'
}

function resolveVariants(
  eval_: EffectivenessEval,
  fileVariants: Variant[] | undefined,
  discoveredVariants: DiscoveredVariant[],
): ResolvedVariant[] {
  // Build pools
  const inlinePool: ResolvedVariant[] = (fileVariants ?? [])
    .filter(v => v.enabled)
    .map(v => ({ name: v.name, dirPath: null, inlineContent: v.value }))

  const fsPool: ResolvedVariant[] = discoveredVariants.map(v => ({
    name: v.name,
    dirPath: v.dirPath,
    inlineContent: null,
  }))

  // Merge: filesystem wins on collision
  const merged = new Map<string, ResolvedVariant>()
  for (const v of inlinePool) {
    merged.set(v.name, v)
  }
  for (const v of fsPool) {
    if (merged.has(v.name)) {
      console.warn(
        `Warning: variant "${v.name}" found both inline and as filesystem variant; using filesystem version`,
      )
    }
    merged.set(v.name, v)
  }

  const ref = eval_.variants

  if (ref === 'all') {
    return Array.from(merged.values())
  }

  if (ref.length === 0) return []

  if (isStringArray(ref)) {
    const names = new Set(ref)
    const result: ResolvedVariant[] = []
    for (const name of names) {
      const v = merged.get(name)
      if (v) {
        result.push(v)
      } else {
        console.warn(`Warning: variant "${name}" referenced but not found`)
      }
    }
    return result
  }

  // Inline definitions in the eval itself
  const inlineDefs: ResolvedVariant[] = ref
    .filter(v => v.enabled)
    .map(v => ({ name: v.name, dirPath: null, inlineContent: v.value }))

  // Check for filesystem collisions
  for (const v of inlineDefs) {
    const fsMatch = fsPool.find(f => f.name === v.name)
    if (fsMatch) {
      console.warn(
        `Warning: variant "${v.name}" found both inline and as filesystem variant; using filesystem version`,
      )
      v.dirPath = fsMatch.dirPath
      v.inlineContent = null
    }
  }

  return inlineDefs
}

function resolveMatrix(
  eval_: EffectivenessEval,
  file: EffectivenessFile,
  defaultMatrix?: { evaluators: MatrixEntry[]; judges: MatrixEntry[] },
): { evaluators: MatrixEntry[]; judges: MatrixEntry[] } {
  const matrix = eval_.matrix ?? file.matrix

  const evaluators = matrix?.evaluators ?? defaultMatrix?.evaluators ?? []
  const judges = matrix?.judges ?? defaultMatrix?.judges ?? []

  // Resolve file-level model shorthand into evaluators if none specified
  const resolvedEvaluators =
    evaluators.length === 0 && file.model ? [parseModelShorthand(file.model)] : evaluators

  // Resolve file-level judge shorthand into judges if none specified
  const resolvedJudges =
    judges.length === 0 && file.judge ? [parseModelShorthand(file.judge)] : judges

  return { evaluators: resolvedEvaluators, judges: resolvedJudges }
}

/** Parses "provider/model" shorthand into a MatrixEntry. Falls back to provider from model prefix. */
function parseModelShorthand(shorthand: string): MatrixEntry {
  const slashIndex = shorthand.indexOf('/')
  if (slashIndex > 0) {
    const provider = shorthand.slice(0, slashIndex) as MatrixEntry['provider']
    const model = shorthand.slice(slashIndex + 1)
    return { provider, model }
  }
  // If no slash, treat as model name with 'openai' as default provider
  return { provider: 'openai', model: shorthand }
}

function resolveRunMode(
  eval_: EffectivenessEval,
  file: EffectivenessFile,
): 'all' | 'variants-only' | 'current-only' {
  return eval_['run-mode'] ?? file['run-mode'] ?? 'all'
}

export function buildEffectivenessWorkItems(
  options: EffectivenessRunnerOptions,
): EffectivenessAgentWorkItem[] {
  const { effectivenessFiles, fixtures, skills, defaultMatrix, discoveredVariants } = options
  const items: EffectivenessAgentWorkItem[] = []

  for (const { file, skillName } of effectivenessFiles) {
    if (skillName === null) continue

    const skill = skills.find(s => s.name === skillName)
    if (!skill) continue

    const skillFixtures = fixtures.get(skillName) ?? []

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
      const skillDiscoveredVariants = discoveredVariants?.get(skillName) ?? []
      const variants = resolveVariants(eval_, file.variants, skillDiscoveredVariants)
      const runMode = resolveRunMode(eval_, file)

      for (const fixture of evalFixtures) {
        for (const evaluator of evaluators) {
          // Current run
          if (runMode !== 'variants-only') {
            items.push({
              eval_,
              fixture,
              evaluator,
              judges,
              skillName,
              skillDirPath: skill.dirPath,
              timeout,
              variantName: 'current',
              variantSkillDir: skill.dirPath,
            })
          }

          // Variant runs
          if (runMode !== 'current-only') {
            for (const variant of variants) {
              const item: EffectivenessAgentWorkItem = {
                eval_,
                fixture,
                evaluator,
                judges,
                skillName,
                skillDirPath: skill.dirPath,
                timeout,
                variantName: variant.name,
                variantSkillDir: variant.dirPath ?? skill.dirPath,
              }
              if (variant.inlineContent !== null) {
                item.inlineSkillContent = variant.inlineContent
              }
              items.push(item)
            }
          }
        }
      }
    }
  }

  return items
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
      const fileStat = await stat(fullPath)
      if (!fileStat.isFile()) continue
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
    const resolvedSkillDir =
      item.inlineSkillContent !== undefined ? item.skillDirPath : item.variantSkillDir
    const sandboxOptions: SandboxOptions = {
      runId,
      skillName: item.skillName ?? 'unknown',
      fixtureName: item.fixture.name,
      skillDirPath: resolvedSkillDir,
      fixtureTestsDir: item.fixture.testsDir,
      evaluatorId,
      sample: runIndex,
    }

    const sandbox = await createSandbox(sandboxOptions)

    try {
      // For inline variants, overwrite the SKILL.md in the sandbox skill dir
      if (item.inlineSkillContent !== undefined) {
        await writeFile(path.join(sandbox.skillDir, 'SKILL.md'), item.inlineSkillContent, 'utf-8')
      }

      // Capture skill content before setup/agent run to ensure judge scores the intended prompt
      const skillContent = await readFile(path.join(sandbox.skillDir, 'SKILL.md'), 'utf-8')

      await runSetup(sandbox, signal)
      const artifact = await spawnAgent(item, sandbox, signal)
      const { fsDiff } = await finalizeSandbox(sandbox)

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
            variant: item.variantName,
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
            variant: item.variantName,
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
            variant: item.variantName,
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
      variant: item.variantName,
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
              variant: items[j].variantName,
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
