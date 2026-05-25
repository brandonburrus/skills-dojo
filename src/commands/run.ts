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
import {
  discoverSelectionFiles,
  discoverEffectivenessFiles,
  discoverFixtures,
} from '../loaders/eval.js'
import { formatRunReport, formatEffectivenessReport } from '../output/table.js'
import { dojoBanner, errorText, heading } from '../output/cli.js'
import { createEvaluator, createJudge } from '../providers/factory.js'
import {
  buildWorkItems,
  runSingleEval,
  type EvalResult,
  type WorkItem,
} from '../runner/selection.js'
import {
  buildEffectivenessWorkItems,
  runSingleEffectivenessEval,
  type EffectivenessAgentWorkItem,
  type EffectivenessEvalResult,
} from '../runner/effectiveness.js'
import type { Judge } from '../providers/types.js'
import type { DiscoveredFixture, RunReport } from '../types.js'
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

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4o-mini',
  copilot: 'gpt-4.1',
  vercel: 'openai/gpt-4o-mini',
}

function getDefaultModel(provider: string): string {
  return DEFAULT_MODELS[provider] ?? provider
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

interface UnifiedListrContext {
  selectionResults: EvalResult[]
  effectivenessResults: EffectivenessEvalResult[]
}

export async function runCommand(
  skill: string | undefined,
  options: {
    eval?: string
    variant?: string
    output?: string
    inspect?: boolean
    parallelism?: string
    evalType?: string
    selection?: boolean
    effectiveness?: boolean
    evaluationModel?: string
    judgeModel?: string
    modelProvider?: string
    fixture?: string
    judgeFilter?: string
    keepSandbox?: boolean
    yes?: boolean
    json?: boolean
    quiet?: boolean
  },
  startDir?: string,
  overrides?: ConfigOverrides,
  configFile?: string,
): Promise<void> {
  const mergedOverrides: ConfigOverrides = {
    ...overrides,
    ...(options.modelProvider && { modelProvider: options.modelProvider }),
    ...(options.evaluationModel && { evaluatorModel: options.evaluationModel }),
    ...(options.judgeModel && { judgeModel: options.judgeModel }),
  }
  const { config, configDir } = await loadConfig(startDir, mergedOverrides, configFile)
  const dirs = Array.isArray(config.skills.dir) ? config.skills.dir : [config.skills.dir]
  const skills = await discoverSkills(dirs, configDir)

  const evalType = options.selection
    ? 'selection'
    : options.effectiveness
      ? 'effectiveness'
      : (options.evalType ?? 'all')
  const runSelection = evalType === 'all' || evalType === 'selection'
  const runEffectiveness = evalType === 'all' || evalType === 'effectiveness'

  let selectionFiles = runSelection ? await discoverSelectionFiles(configDir, skills) : []

  if (skill) {
    selectionFiles = selectionFiles.filter(
      sf => sf.skillName != null && globMatch(skill, sf.skillName),
    )
  }

  let effectivenessFiles = runEffectiveness
    ? await discoverEffectivenessFiles(configDir, skills)
    : []

  if (skill) {
    effectivenessFiles = effectivenessFiles.filter(
      ef => ef.skillName != null && globMatch(skill, ef.skillName),
    )
  }

  const fixturesMap = new Map<string, DiscoveredFixture[]>()
  if (runEffectiveness) {
    for (const s of skills) {
      const evalsDir = path.join(s.dirPath, 'evals')
      const fixtures = await discoverFixtures(evalsDir)
      if (fixtures.length > 0) {
        fixturesMap.set(s.name, fixtures)
      }
    }
  }

  if (selectionFiles.length === 0 && effectivenessFiles.length === 0) {
    console.error(errorText('No evals found.'))
    return
  }

  const evaluator = createEvaluator(config.model.provider)

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

  const parallelism =
    options.parallelism === 'false' || (options.parallelism as unknown) === false
      ? 1
      : options.parallelism
        ? Number.parseInt(options.parallelism, 10)
        : availableParallelism()

  const isInspect = options.inspect === true

  const loggers = new Map<string | null, pino.Logger>()
  const logStreams: Array<{ end: () => void }> = []

  const uniqueSkills = [
    ...new Set([
      ...selectionFiles.map(sf => sf.skillName),
      ...effectivenessFiles.map(ef => ef.skillName),
    ]),
  ]

  for (const skillName of uniqueSkills) {
    const runDir = runDirForSkill(skillName)
    await mkdir(runDir, { recursive: true })
    const stream = createWriteStream(path.join(runDir, 'logs.json'), { flags: 'a' })
    logStreams.push(stream)
    loggers.set(skillName, pino({ timestamp: pino.stdTimeFunctions.isoTime }, stream))
  }

  let aborted = false
  const startTime = Date.now()

  try {
    // --- Preflight: validate effectiveness eval prerequisites early ---
    let effectivenessWorkItems: EffectivenessAgentWorkItem[] = []
    let judgesMap = new Map<string, Judge>()

    if (runEffectiveness && effectivenessFiles.length > 0) {
      const preflightDefaultModel = config.model.evaluator ?? getDefaultModel(config.model.provider)
      const preflightJudgeModel = config.model.judge ?? getDefaultModel(config.model.provider)
      const preflightMatrix = {
        evaluators: [{ provider: config.model.provider, model: preflightDefaultModel }],
        judges: [{ provider: config.model.provider, model: preflightJudgeModel }],
      }

      const preflightWorkItems = buildEffectivenessWorkItems({
        skills,
        effectivenessFiles,
        fixtures: fixturesMap,
        judges: new Map(),
        runId,
        defaultMatrix: preflightMatrix,
      })

      if (preflightWorkItems.length > 0) {
        const providers = new Set(preflightWorkItems.map(i => i.evaluator.provider))
        for (const provider of providers) {
          if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
            console.error(
              errorText(
                'ANTHROPIC_API_KEY environment variable is required for effectiveness evals with the anthropic provider.',
              ),
            )
            return
          }
          if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
            console.error(
              errorText(
                'OPENAI_API_KEY environment variable is required for effectiveness evals with the openai provider.',
              ),
            )
            return
          }
        }

        const judgeProviders = new Set(
          preflightWorkItems.flatMap(i => i.judges.map(j => j.provider)),
        )
        for (const provider of judgeProviders) {
          if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
            console.error(
              errorText(
                'ANTHROPIC_API_KEY environment variable is required for judge with the anthropic provider.',
              ),
            )
            return
          }
          if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
            console.error(
              errorText(
                'OPENAI_API_KEY environment variable is required for judge with the openai provider.',
              ),
            )
            return
          }
        }
      }

      // Build effectiveness work items
      const defaultEvaluatorModel = config.model.evaluator ?? getDefaultModel(config.model.provider)
      const defaultJudgeModel = config.model.judge ?? getDefaultModel(config.model.provider)

      const defaultMatrix = {
        evaluators: [{ provider: config.model.provider, model: defaultEvaluatorModel }],
        judges: [{ provider: config.model.provider, model: defaultJudgeModel }],
      }

      effectivenessWorkItems = buildEffectivenessWorkItems({
        skills,
        effectivenessFiles,
        fixtures: fixturesMap,
        judges: new Map(),
        runId,
        defaultMatrix,
      })

      if (options.eval) {
        effectivenessWorkItems = effectivenessWorkItems.filter(item =>
          globMatch(options.eval!, item.eval_.name),
        )
      }

      if (options.fixture) {
        effectivenessWorkItems = effectivenessWorkItems.filter(item =>
          globMatch(options.fixture!, item.fixture.name),
        )
      }
    }

    if (!options.quiet) {
      console.error(dojoBanner())
      console.error(heading(`Starting run: ${chalk.italic.blueBright(runId)}`))
      console.error('')
    }

    // --- Effectiveness cost preflight and threshold checks (before Listr run) ---
    if (effectivenessWorkItems.length > 0) {
      const evalNames = new Set(effectivenessWorkItems.map(i => i.eval_.name))
      const fixtureNames = new Set(effectivenessWorkItems.map(i => i.fixture.name))
      const evaluatorIds = new Set(
        effectivenessWorkItems.map(i => `${i.evaluator.provider}/${i.evaluator.model}`),
      )
      const judgeCount = new Set(
        effectivenessWorkItems.flatMap(i => i.judges.map(j => `${j.provider}/${j.model}`)),
      ).size
      const agentRuns = effectivenessWorkItems.length
      const judgeCalls = effectivenessWorkItems.reduce((sum, i) => sum + i.judges.length, 0)

      console.error(chalk.bold('Effectiveness evals:'))
      console.error(
        `  ${evalNames.size} evals \u00d7 ${fixtureNames.size} fixtures \u00d7 ${evaluatorIds.size} evaluator${evaluatorIds.size > 1 ? 's' : ''} \u00d7 ${judgeCount} judge${judgeCount > 1 ? 's' : ''} = ${agentRuns} agent runs + ${judgeCalls} judge calls`,
      )

      // Threshold warnings
      let shouldAbort = false
      const activeSkillNames = new Set(effectivenessWorkItems.map(i => i.skillName))
      for (const s of skills.filter(s => activeSkillNames.has(s.name))) {
        const sf = fixturesMap.get(s.name) ?? []
        if (sf.length > config.effectiveness.confirmFixtureThreshold && !options.yes) {
          console.error(
            errorText(
              `\u2716 Skill "${s.name}" has ${sf.length} fixtures (> confirm threshold of ${config.effectiveness.confirmFixtureThreshold}). Use --yes to proceed.`,
            ),
          )
          shouldAbort = true
        } else if (sf.length > config.effectiveness.warnFixtureThreshold) {
          console.error(
            chalk.yellow(
              `\u26a0 Skill "${s.name}" has ${sf.length} fixtures (> warn threshold of ${config.effectiveness.warnFixtureThreshold})`,
            ),
          )
        }
      }

      if (shouldAbort) {
        return
      }

      // Create judges
      const judgeEntries = [
        ...new Set(
          effectivenessWorkItems.flatMap(i => i.judges.map(j => `${j.provider}/${j.model}`)),
        ),
      ]
      judgesMap = new Map<string, Judge>()
      for (const judgeId of judgeEntries) {
        const [provider, ...modelParts] = judgeId.split('/')
        const model = modelParts.join('/')
        if (options.judgeFilter && judgeId !== options.judgeFilter) continue
        judgesMap.set(judgeId, createJudge(provider as Parameters<typeof createJudge>[0], model))
      }

      // Filter work items to only include instantiated judges
      if (options.judgeFilter) {
        effectivenessWorkItems = effectivenessWorkItems
          .map(item => ({
            ...item,
            judges: item.judges.filter(j => judgesMap.has(`${j.provider}/${j.model}`)),
          }))
          .filter(item => item.judges.length > 0)
      }

      console.error('')
    } else if (runEffectiveness && effectivenessFiles.length > 0) {
      console.error(errorText('No effectiveness eval work items generated. Possible causes:'))
      console.error(errorText('  - No fixtures found (expected in evals/fixtures/<name>/tests/)'))
      console.error(errorText('  - Matrix has no evaluators or judges configured'))
      console.error(errorText('  - All evals are disabled'))
    }

    // --- Build selection task items ---
    let selectionWorkItems: WorkItem[] = []
    if (runSelection && selectionFiles.length > 0) {
      selectionWorkItems = buildWorkItems({
        evaluator,
        skills,
        selectionFiles,
        defaultModel: config.model.evaluator ?? getDefaultModel(config.model.provider),
        variantFilter: options.variant,
      })

      if (options.eval) {
        selectionWorkItems = selectionWorkItems.filter(item =>
          globMatch(options.eval!, item.eval_.name),
        )
      }
    }

    // --- Build unified task list and run ---
    const allTaskItems: Array<{
      title: string
      task: (_ctx: UnifiedListrContext, task: { title: string }) => Promise<void>
    }> = []

    if (selectionWorkItems.length > 0) {
      const totalSelRuns = selectionWorkItems.length
      for (let index = 0; index < selectionWorkItems.length; index++) {
        const item = selectionWorkItems[index]
        allTaskItems.push({
          title: taskTitle(item.skillName, item.eval_.name, item.variantName),
          task: async (_ctx: UnifiedListrContext, task: { title: string }) => {
            const onEvent = (event: { type: string; [key: string]: unknown }): void => {
              const logger = loggers.get(item.skillName)
              if (logger) {
                const data = (event.data ?? {}) as Record<string, unknown>
                logger.info({ eventType: event.type, ...data })
              }
              if (isInspect) handleSessionEvent(event)
            }

            const result = await runSingleEval(item, index, totalSelRuns, {
              evaluator,
              signal: ac.signal,
              onEvent,
            })

            task.title = completedTitle(item.skillName, item.eval_.name, item.variantName, result)
            _ctx.selectionResults.push(result)

            if (!result.passed) {
              throw new Error(task.title)
            }
          },
        })
      }
    }

    if (effectivenessWorkItems.length > 0) {
      const totalEffRuns = effectivenessWorkItems.length
      for (let index = 0; index < effectivenessWorkItems.length; index++) {
        const item = effectivenessWorkItems[index]
        allTaskItems.push({
          title: `${item.skillName ?? ''} ${item.eval_.name} [fixture: ${item.fixture.name}]`,
          task: async (_ctx: UnifiedListrContext, task: { title: string }) => {
            const results = await runSingleEffectivenessEval(item, index, totalEffRuns, {
              judges: judgesMap,
              signal: ac.signal,
              runId,
              keepSandbox: options.keepSandbox,
            })

            const allPassed = results.every(r => r.passed)
            const duration = results[0]?.durationMs ?? 0
            task.title = `${item.skillName ?? ''} ${item.eval_.name} [fixture: ${item.fixture.name}] ${chalk.dim(`(${(duration / 1000).toFixed(1)}s)`)}`
            _ctx.effectivenessResults.push(...results)

            if (!allPassed) {
              throw new Error(task.title)
            }
          },
        })
      }
    }

    if (allTaskItems.length > 0) {
      const sharedOptions = {
        concurrent: parallelism,
        exitOnError: false,
        collectErrors: 'minimal' as const,
      }

      // biome-ignore lint/suspicious/noExplicitAny: listr2 renderer generics make a single type impractical
      let tasks: Listr<UnifiedListrContext, any, any>
      if (isInspect) {
        // biome-ignore lint/suspicious/noExplicitAny: listr2 renderer types require exact literal match
        tasks = new Listr<UnifiedListrContext, any, any>(allTaskItems, {
          ...sharedOptions,
          renderer: 'verbose',
          fallbackRenderer: 'simple',
        })
      } else if (options.quiet) {
        // biome-ignore lint/suspicious/noExplicitAny: listr2 renderer types require exact literal match
        tasks = new Listr<UnifiedListrContext, any, any>(allTaskItems, {
          ...sharedOptions,
          renderer: 'silent',
          fallbackRenderer: 'silent',
        })
      } else {
        // biome-ignore lint/suspicious/noExplicitAny: listr2 renderer types require exact literal match
        tasks = new Listr<UnifiedListrContext, any, any>(allTaskItems, {
          ...sharedOptions,
          renderer: 'default',
          fallbackRenderer: 'simple',
          rendererOptions: {
            color: {
              [ListrDefaultRendererLogLevels.PENDING]: (message?: string) =>
                chalk.blue(message ?? ''),
            },
          },
        })
      }

      const initialCtx: UnifiedListrContext = { selectionResults: [], effectivenessResults: [] }
      let ctx: UnifiedListrContext

      try {
        ctx = await tasks.run(initialCtx)
      } catch {
        ctx = initialCtx
      }

      aborted = ac.signal.aborted

      // --- Display selection results ---
      if (ctx.selectionResults.length > 0) {
        const reportsBySkill = new Map<string | null, EvalResult[]>()
        for (const result of ctx.selectionResults) {
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
            totalEvals: ctx.selectionResults.length,
            passed: ctx.selectionResults.filter(r => r.passed).length,
            failed: ctx.selectionResults.filter(r => !r.passed).length,
            results: ctx.selectionResults,
          }
          await mkdir(path.dirname(path.resolve(options.output)), { recursive: true })
          await writeFile(options.output, JSON.stringify(combined, null, 2))
        }
      }

      // --- Display effectiveness results ---
      if (ctx.effectivenessResults.length > 0) {
        const effBySkill = new Map<string | null, EffectivenessEvalResult[]>()
        for (const result of ctx.effectivenessResults) {
          const list = effBySkill.get(result.skillName) ?? []
          list.push(result)
          effBySkill.set(result.skillName, list)
        }
        for (const [skillName, skillResults] of effBySkill) {
          const runDir = runDirForSkill(skillName)
          await mkdir(runDir, { recursive: true })

          const passedCount = skillResults.filter(r => r.passed).length
          const report = {
            runId,
            timestamp: new Date().toISOString(),
            skill: skillName ?? 'root',
            totalEvals: skillResults.length,
            passed: passedCount,
            failed: skillResults.length - passedCount,
            results: skillResults,
          }

          await writeFile(
            path.join(runDir, 'effectiveness-report.json'),
            JSON.stringify(report, null, 2),
          )

          console.error('')
          console.error(formatEffectivenessReport(skillName ?? 'root', skillResults))
        }
      }

      const hasSelectionFailures = ctx.selectionResults.some(r => !r.passed)
      const hasEffectivenessFailures = ctx.effectivenessResults.some(r => !r.passed || r.error)
      if (hasSelectionFailures || hasEffectivenessFailures) {
        process.exitCode = 1
      }

      if (options.json) {
        const combined = {
          runId,
          timestamp: new Date().toISOString(),
          selection: ctx.selectionResults,
          effectiveness: ctx.effectivenessResults,
        }
        console.log(JSON.stringify(combined, null, 2))
      }
    }

    console.error(`\nCompleted in ${((Date.now() - startTime) / 1000).toFixed(1)}s`)

    if (aborted) {
      console.error(errorText('Run interrupted.'))
      process.exitCode = 1
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
  evalType?: string
  selection?: boolean
  effectiveness?: boolean
  evaluationModel?: string
  judgeModel?: string
  modelProvider?: string
  fixture?: string
  judgeFilter?: string
  keepSandbox?: boolean
  yes?: boolean
  json?: boolean
  quiet?: boolean
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
  .option(
    '-t, --eval-type <type>',
    'Filter by eval type: "selection", "effectiveness", or "all"',
    'all',
  )
  .option('--selection', 'Run only selection evals (shortcut for -t selection)')
  .option('--effectiveness', 'Run only effectiveness evals (shortcut for -t effectiveness)')
  .option('-m, --evaluation-model <model>', 'Override evaluation model')
  .option('-j, --judge-model <model>', 'Override judge model')
  .option('--model-provider <provider>', 'Override model provider')
  .option('-f, --fixture <name>', 'Filter effectiveness evals to a specific fixture')
  .option('--judge-filter <id>', 'Filter to a specific judge (format: "provider/model")')
  .option('--keep-sandbox', "Don't clean up sandbox temp directories after run")
  .option('-y, --yes', 'Skip confirmation prompts for large eval runs')
  .option('--json', 'Output combined report as JSON to stdout')
  .option('-q, --quiet', 'Suppress progress output (still shows results)')
  .addHelpText(
    'after',
    `
Examples:
  dojo run                         Run all evals for all skills
  dojo run sql-queries             Run all evals for a specific skill
  dojo run --selection             Run only selection evals
  dojo run --effectiveness         Run only effectiveness evals
  dojo run -m gpt-4.1 -j claude-sonnet-4-20250514  Override models
  dojo run -e my-eval -f my-fix    Run a specific eval and fixture`,
  )
  .action(function (this: Command, skill: string | undefined, options: RunOptions) {
    const { startDir, configFile, overrides } = getGlobalOptions(this)
    return runCommand(skill, options, startDir, overrides, configFile)
  })
