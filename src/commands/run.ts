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
import { discoverEvals } from '../loaders/eval.js'
import { discoverVariants } from '../loaders/variant.js'
import { formatRunReport } from '../output/table.js'
import { dojoBanner, errorText, heading } from '../output/cli.js'
import { CopilotEvaluator } from '../providers/copilot/evaluator.js'
import {
  buildWorkItems,
  runSingleEval,
  type EvalResult,
  type WorkItem,
} from '../runner/selection.js'
import type { RunReport, Variant } from '../types.js'
import { generateRunId } from '../utils/run-id.js'
import { getGlobalOptions } from './globals.js'
import { globMatch } from '../utils/glob-match.js'

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional stripping of ANSI/control sequences
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]|\x1B\[[0-9;]*[A-Za-z]/g

function sanitize(value: unknown): string {
  const str = typeof value === 'string' ? value : String(value ?? '')
  return str.replace(CONTROL_CHARS_RE, '')
}

const SUPPRESSED_EVENTS = new Set([
  'session.usage_info',
  'assistant.streaming_delta',
  'assistant.usage',
  'pending_messages.modified',
  'session.title_changed',
  'session.snapshot_rewind',
  'session.truncation',
  'session.compaction_start',
  'session.compaction_complete',
  'session.context_changed',
  'session.plan_changed',
  'session.workspace_file_changed',
  'session.mode_changed',
  'session.remote_steerable_changed',
])

let streaming = false

function endStream(): void {
  if (streaming) {
    process.stderr.write('\n')
    streaming = false
  }
}

function handleSessionEvent(event: { type: string; [key: string]: unknown }): void {
  const data = (event.data ?? {}) as Record<string, unknown>

  if (SUPPRESSED_EVENTS.has(event.type)) return

  switch (event.type) {
    case 'session.start': {
      endStream()
      const model = sanitize(data.selectedModel)
      const sessionId = sanitize(data.sessionId)
      if (model) console.error(chalk.dim(`  model: ${model}`))
      if (sessionId) console.error(chalk.dim(`  session: ${sessionId}`))
      break
    }

    case 'user.message':
      endStream()
      console.error(chalk.dim(`  prompt: "${sanitize(data.content)}"`))
      break

    case 'assistant.reasoning_delta':
      if (!streaming) {
        console.error(chalk.dim('  reasoning:'))
        process.stderr.write('  ')
      }
      streaming = true
      process.stderr.write(chalk.dim.italic(sanitize(data.deltaContent)))
      break

    case 'assistant.reasoning':
      endStream()
      break

    case 'assistant.message_delta':
      if (!streaming) {
        console.error(chalk.dim('  assistant:'))
        process.stderr.write('  ')
      }
      streaming = true
      process.stderr.write(sanitize(data.deltaContent))
      break

    case 'assistant.message': {
      endStream()
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

    case 'assistant.intent':
      endStream()
      console.error(chalk.dim(`  intent: ${sanitize(data.intent)}`))
      break

    case 'assistant.turn_start':
      endStream()
      console.error(chalk.dim(`  turn ${sanitize(data.turnId)} start`))
      break

    case 'assistant.turn_end':
      endStream()
      console.error(chalk.dim(`  turn ${sanitize(data.turnId)} end`))
      break

    case 'tool.execution_start':
      endStream()
      console.error(chalk.dim(`  tool start: ${sanitize(data.toolName)}`))
      break

    case 'tool.execution_complete':
      endStream()
      console.error(
        chalk.dim(`  tool complete: ${sanitize(data.toolName)} (${data.success ? 'ok' : 'fail'})`),
      )
      break

    case 'session.idle':
      endStream()
      console.error(chalk.dim(`  idle${data.aborted ? ' (aborted)' : ''}`))
      break

    case 'abort':
      endStream()
      console.error(chalk.dim(`  abort: ${sanitize(data.reason)}`))
      break

    case 'session.error':
      endStream()
      console.error(errorText(`  error [${sanitize(data.errorType)}]: ${sanitize(data.message)}`))
      break

    case 'session.warning':
      endStream()
      console.error(chalk.yellow(`  warning: ${sanitize(data.message)}`))
      break

    case 'session.info':
      endStream()
      console.error(chalk.dim(`  info: ${sanitize(data.message)}`))
      break

    default:
      endStream()
      console.error(chalk.dim(`  ${event.type}`))
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
    type?: string
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
  let evals = await discoverEvals(configDir, skills)

  if (options.type) {
    evals = evals.filter(s => s.eval.type === options.type)
  }

  if (skill) {
    evals = evals.filter(s => s.skillName != null && globMatch(skill, s.skillName))
  }

  if (options.eval) {
    evals = evals.filter(s => globMatch(options.eval!, s.eval.name))
  }

  if (evals.length === 0) {
    console.error(errorText('No evals found.'))
    return
  }

  const variantFiles = await discoverVariants(skills)
  const skillVariants = new Map<string, Variant[]>()
  for (const vf of variantFiles) {
    const existing = skillVariants.get(vf.skillName) ?? []
    skillVariants.set(vf.skillName, [...existing, ...vf.variants])
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

  const uniqueSkills = [...new Set(evals.map(e => e.skillName))]
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

  const workItems = buildWorkItems({
    evaluator,
    skills,
    evals,
    skillVariants,
    variantFilter: options.variant,
  })
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

      const result = await runSingleEval(
        item.eval_,
        item.skillList,
        item.variantName,
        item.skillName,
        index,
        totalRuns,
        {
          evaluator,
          signal: ac.signal,
          onEvent,
        },
      )

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
    console.error(heading(`Starting run: ${chalk.bold.italic.yellow(runId)}`))
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
      console.error('')
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
  type?: string
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
  .option('-t, --type <type>', 'Filter by eval type (selection)')
  .option('-o, --output <path>', 'Write combined report to file')
  .option('-i, --inspect', 'Show full session telemetry and streaming output')
  .action(function (this: Command, skill: string | undefined, options: RunOptions) {
    const { startDir, overrides } = getGlobalOptions(this)
    return runCommand(skill, options, startDir, overrides)
  })
