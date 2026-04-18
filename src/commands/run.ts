import { availableParallelism } from 'node:os'
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import chalk from 'chalk'
import { Command } from 'commander'
import { Listr, ListrDefaultRendererLogLevels } from 'listr2'
import pino from 'pino'
import { loadConfig, type ConfigOverrides } from '../loaders/config.js'
import { discoverSkills } from '../loaders/skill.js'
import { discoverSelectionFiles } from '../loaders/eval.js'
import { formatRunReport } from '../output/table.js'
import { dojoBanner, errorText, heading } from '../output/cli.js'
import { CopilotEvaluator } from '../providers/copilot/evaluator.js'
import {
  buildWorkItems,
  runSingleEval,
  type EvalResult,
  type WorkItem,
} from '../runner/selection.js'
import type { RunReport } from '../types.js'
import { generateRunId } from '../utils/run-id.js'
import { getGlobalOptions } from './globals.js'
import { globMatch } from '../utils/glob-match.js'

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional stripping of ANSI/control sequences
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]|\x1B\[[0-9;]*[A-Za-z]/g

function sanitize(value: unknown): string {
  const str = typeof value === 'string' ? value : String(value ?? '')
  return str.replace(CONTROL_CHARS_RE, '')
}

/**
 * Handles session events for --inspect mode. Only surfaces actionable
 * information: model selection, prompt, tool calls, and errors/warnings.
 * Streaming deltas, turn lifecycle, and reasoning are suppressed —
 * the full event stream is always captured in logs.json.
 */
function handleSessionEvent(event: { type: string; [key: string]: unknown }): void {
  const data = (event.data ?? {}) as Record<string, unknown>

  switch (event.type) {
    case 'session.start': {
      const model = sanitize(data.selectedModel)
      if (model) console.error(chalk.dim(`  model: ${model}`))
      break
    }

    case 'user.message':
      console.error(chalk.dim(`  prompt: "${sanitize(data.content)}"`))
      break

    case 'assistant.message': {
      const toolRequests = data.toolRequests as
        | Array<{ name?: string; arguments?: Record<string, unknown> }>
        | undefined
      if (toolRequests?.length) {
        for (const req of toolRequests) {
          const args = req.arguments ? JSON.stringify(req.arguments) : ''
          console.error(chalk.dim(`  tool call: ${sanitize(req.name)}(${sanitize(args)})`))
        }
      }
      break
    }

    case 'session.error':
      console.error(errorText(`  error [${sanitize(data.errorType)}]: ${sanitize(data.message)}`))
      break

    case 'session.warning':
      console.error(chalk.yellow(`  warning: ${sanitize(data.message)}`))
      break

    case 'abort':
      console.error(chalk.dim(`  abort: ${sanitize(data.reason)}`))
      break

    default:
      break
  }
}

function variantLabel(variantName: string): string {
  return variantName === 'base' ? '[current]' : `[variant: ${variantName}]`
}

function taskTitle(skillName: string | null, evalName: string, variantName: string): string {
  const skill = skillName ? `${skillName} ` : ''
  return `${skill}${evalName} ${variantLabel(variantName)}`
}

function completedTitle(
  skillName: string | null,
  evalName: string,
  variantName: string,
  result: EvalResult,
): string {
  const duration = chalk.dim(`(${(result.durationMs / 1000).toFixed(1)}s)`)
  const prefix = skillName ? `${skillName} ` : ''
  return `${prefix}${evalName} ${variantLabel(variantName)} ${duration}`
}

interface ListrContext {
  results: EvalResult[]
}

export async function runCommand(
  skill: string | undefined,
  options: {
    eval?: string
    variant?: string
    output?: string
    inspect?: boolean
    parallelism?: string
  },
  startDir?: string,
  overrides?: ConfigOverrides,
): Promise<void> {
  const { config, configDir } = await loadConfig(startDir, overrides)
  const dirs = Array.isArray(config.skills.dir) ? config.skills.dir : [config.skills.dir]
  const skills = await discoverSkills(dirs, configDir)

  let selectionFiles = await discoverSelectionFiles(configDir, skills)

  if (skill) {
    selectionFiles = selectionFiles.filter(
      sf => sf.skillName != null && globMatch(skill, sf.skillName),
    )
  }

  if (selectionFiles.length === 0) {
    console.error(errorText('No evals found.'))
    return
  }

  const provider = config.model.provider
  if (provider !== 'copilot') {
    throw new Error(`Unknown evaluator provider: "${provider}". Only "copilot" is supported.`)
  }
  const evaluator = new CopilotEvaluator()

  const runId = generateRunId()
  const ac = new AbortController()
  const sigintHandler = (): void => {
    ac.abort()
  }
  process.once('SIGINT', sigintHandler)

  const skillDirs = new Map(skills.map(s => [s.name, s.dirPath]))

  const runDirForSkill = (skillName: string | null): string => {
    if (skillName !== null) {
      const dirPath = skillDirs.get(skillName)
      if (dirPath) return path.join(dirPath, 'evals', 'reports', runId)
    }
    return path.join(configDir, 'evals', 'reports', runId)
  }

  let workItems = buildWorkItems({
    evaluator,
    skills,
    selectionFiles,
    defaultModel: config.model.evaluator,
    variantFilter: options.variant,
  })

  if (options.eval) {
    workItems = workItems.filter(item => globMatch(options.eval!, item.eval_.name))
  }

  if (workItems.length === 0) {
    console.error(errorText('No evals found.'))
    return
  }

  const uniqueSkills = [...new Set(selectionFiles.map(sf => sf.skillName))]
  const loggers = new Map<string | null, pino.Logger>()
  const logStreams: Array<{ end: () => void }> = []

  for (const skillName of uniqueSkills) {
    const runDir = runDirForSkill(skillName)
    await mkdir(runDir, { recursive: true })
    const stream = createWriteStream(path.join(runDir, 'logs.json'), { flags: 'a' })
    logStreams.push(stream)
    loggers.set(skillName, pino({ timestamp: pino.stdTimeFunctions.isoTime }, stream))
  }

  const parallelism =
    options.parallelism === 'false' || (options.parallelism as unknown) === false
      ? 1
      : options.parallelism
        ? Number.parseInt(options.parallelism, 10)
        : availableParallelism()

  const totalRuns = workItems.length

  const isInspect = options.inspect === true

  const taskItems = workItems.map((item: WorkItem, index: number) => ({
    title: taskTitle(item.skillName, item.eval_.name, item.variantName),
    task: async (_ctx: ListrContext, task: { title: string }) => {
      const onEvent = (event: { type: string; [key: string]: unknown }): void => {
        const logger = loggers.get(item.skillName)
        if (logger) {
          const data = (event.data ?? {}) as Record<string, unknown>
          logger.info({ eventType: event.type, ...data })
        }
        if (isInspect) handleSessionEvent(event)
      }

      const result = await runSingleEval(item, index, totalRuns, {
        evaluator,
        signal: ac.signal,
        onEvent,
      })

      task.title = completedTitle(item.skillName, item.eval_.name, item.variantName, result)
      _ctx.results.push(result)

      if (!result.passed) {
        throw new Error(task.title)
      }
    },
  }))

  const sharedOptions = {
    concurrent: parallelism,
    exitOnError: false,
    collectErrors: 'minimal' as const,
  }

  // biome-ignore lint/suspicious/noExplicitAny: listr2 renderer generics make a single type impractical
  let tasks: Listr<ListrContext, any, any>
  if (isInspect) {
    // biome-ignore lint/suspicious/noExplicitAny: listr2 renderer types require exact literal match
    tasks = new Listr<ListrContext, any, any>(taskItems, {
      ...sharedOptions,
      renderer: 'verbose',
      fallbackRenderer: 'simple',
    })
  } else {
    // biome-ignore lint/suspicious/noExplicitAny: listr2 renderer types require exact literal match
    tasks = new Listr<ListrContext, any, any>(taskItems, {
      ...sharedOptions,
      renderer: 'default',
      fallbackRenderer: 'simple',
      rendererOptions: {
        color: {
          [ListrDefaultRendererLogLevels.PENDING]: (message?: string) => chalk.blue(message ?? ''),
        },
      },
    })
  }

  let aborted = false

  try {
    console.error(dojoBanner())
    console.error(heading(`Starting run: ${chalk.italic.blueBright(runId)}`))
    console.error('')

    const initialCtx: ListrContext = { results: [] }
    let ctx: ListrContext

    try {
      ctx = await tasks.run(initialCtx)
    } catch {
      // listr2 throws when tasks fail with exitOnError: false in some renderers.
      // Results are already collected in the context.
      ctx = initialCtx
    }

    const results = ctx.results

    aborted = ac.signal.aborted

    const reportsBySkill = new Map<string | null, EvalResult[]>()
    for (const result of results) {
      const list = reportsBySkill.get(result.evalSkillName) ?? []
      list.push(result)
      reportsBySkill.set(result.evalSkillName, list)
    }

    const reports: RunReport[] = []

    for (const [skillName, skillResults] of reportsBySkill) {
      const passed = skillResults.filter(r => r.passed).length
      const reportSkillName = skillName ?? 'root'
      const report: RunReport = {
        runId,
        timestamp: new Date().toISOString(),
        skill: reportSkillName,
        totalEvals: skillResults.length,
        passed,
        failed: skillResults.length - passed,
        results: skillResults,
      }
      reports.push(report)

      const runDir = runDirForSkill(skillName)
      await mkdir(runDir, { recursive: true })
      await writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2))

      console.error('')
      console.error(formatRunReport(report))
    }

    if (options.output) {
      const combined: RunReport = {
        runId,
        timestamp: new Date().toISOString(),
        skill: reports.map(r => r.skill).join(', '),
        totalEvals: results.length,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length,
        results,
      }
      await mkdir(path.dirname(path.resolve(options.output)), { recursive: true })
      await writeFile(options.output, JSON.stringify(combined, null, 2))
    }

    if (aborted) {
      console.error(errorText('Run interrupted.'))
    }
  } finally {
    process.removeListener('SIGINT', sigintHandler)
    for (const stream of logStreams) stream.end()
  }
}

interface RunOptions {
  eval?: string
  variant?: string
  output?: string
  inspect?: boolean
  parallelism?: string
}

export const run = new Command('run')
  .description('Run evals')
  .argument('[skill]', 'Filter by skill name')
  .option('-e, --eval <name>', 'Run only evals matching this name')
  .option('-V, --variant <name>', 'Run only a specific variant (by name)')
  .option('-p, --parallelism <n>', 'Max concurrent eval runs (default: CPU cores)')
  .option('--no-parallelism', 'Run evals sequentially')
  .option('-o, --output <path>', 'Write combined report to file')
  .option('-i, --inspect', 'Show full session telemetry and streaming output')
  .action(function (this: Command, skill: string | undefined, options: RunOptions) {
    const { startDir, overrides } = getGlobalOptions(this)
    return runCommand(skill, options, startDir, overrides)
  })
