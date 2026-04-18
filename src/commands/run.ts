import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import chalk from 'chalk'
import ora, { type Ora } from 'ora'
import pino from 'pino'
import { loadConfig, type ConfigOverrides } from '../loaders/config.js'
import { discoverSkills } from '../loaders/skill.js'
import { discoverEvals } from '../loaders/eval.js'
import { formatRunReport } from '../output/table.js'
import { errorText, heading, logSuccess, logFailure } from '../output/cli.js'
import { CopilotEvaluator } from '../providers/copilot/evaluator.js'
import { runSelectionEvals, type EvalResult } from '../runner/selection.js'
import type { RunReport } from '../types.js'
import { generateRunId } from '../utils/run-id.js'

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

export async function runCommand(
  skill: string | undefined,
  options: { type?: string; output?: string; inspect?: boolean },
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
    const filter = skill.toLowerCase()
    evals = evals.filter(s => s.skillName?.toLowerCase().includes(filter))
  }

  if (evals.length === 0) {
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

  let currentEvalSkill: string | null = null

  const onEvent = (event: { type: string; [key: string]: unknown }): void => {
    const logger = loggers.get(currentEvalSkill)
    if (logger) {
      const data = (event.data ?? {}) as Record<string, unknown>
      logger.info({ eventType: event.type, ...data })
    }
    if (options.inspect) handleSessionEvent(event)
  }

  let aborted = false
  let spinner: Ora | undefined

  try {
    const results = await runSelectionEvals({
      evaluator,
      skills,
      evals,
      signal: ac.signal,
      onEvent,
      onProgress: info => {
        const tag = `[${info.evalIndex + 1}/${info.totalEvals}]`

        if (info.status === 'start') {
          currentEvalSkill = evals[info.evalIndex].skillName
          if (options.inspect && info.setup) {
            const { setup } = info
            const promptSnippet =
              setup.prompt.length > 100 ? `${setup.prompt.slice(0, 100)}...` : setup.prompt

            console.error('')
            console.error(`${tag} ${heading(info.evalName)}`)
            console.error(chalk.dim(`  expect: ${setup.expected}`))
            console.error(chalk.dim(`  prompt: "${promptSnippet}"`))
          } else {
            spinner = ora({ text: `${tag} ${info.evalName}`, stream: process.stderr }).start()
          }
        }

        if (info.status === 'complete' && info.result) {
          const { result } = info
          const duration = `${(result.durationMs / 1000).toFixed(1)}s`
          const actual = result.actual.loaded
            ? `loaded "${result.actual.skillName}"`
            : 'no skill loaded'

          if (spinner) {
            if (result.error) {
              spinner.fail(`${tag} ${info.evalName} -- ${result.error} (${duration})`)
            } else if (result.passed) {
              spinner.succeed(`${tag} ${info.evalName} -- ${actual} (${duration})`)
            } else {
              spinner.fail(`${tag} ${info.evalName} -- ${actual} (${duration})`)
            }
            spinner = undefined
          } else {
            if (result.error) {
              logFailure(`${tag} ${info.evalName} -- ${result.error} (${duration})`)
            } else if (result.passed) {
              logSuccess(`${tag} ${info.evalName} -- ${actual} (${duration})`)
            } else {
              logFailure(`${tag} ${info.evalName} -- ${actual} (${duration})`)
            }
          }
        }
      },
    })

    aborted = ac.signal.aborted

    const reportsBySkill = new Map<string | null, EvalResult[]>()
    for (let i = 0; i < evals.length; i++) {
      const skillName = evals[i].skillName
      const list = reportsBySkill.get(skillName) ?? []
      list.push(results[i])
      reportsBySkill.set(skillName, list)
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

    const totalPassed = results.filter(r => r.passed).length
    console.error(heading(`Overall: ${totalPassed}/${results.length} passed`))

    if (aborted) {
      console.error(errorText('Run interrupted.'))
    }
  } finally {
    process.removeListener('SIGINT', sigintHandler)
    for (const stream of logStreams) stream.end()
  }
}
