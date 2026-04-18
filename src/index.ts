import { Command } from 'commander'
import { validateCommand } from './commands/validate.js'
import { listCommand } from './commands/list.js'
import { runCommand } from './commands/run.js'
import type { ConfigOverrides } from './loaders/config.js'
import chalk from 'chalk'
import figlet from 'figlet'

const cliBanner = chalk.bold.redBright(
  figlet.textSync('DOJO', {
    font: 'Sub-Zero',
    horizontalLayout: 'fitted',
    verticalLayout: 'fitted',
    whitespaceBreak: false,
  }),
)

export interface GlobalOptions {
  cwd?: string
  modelProvider?: string
  evaluatorModel?: string
  skillsDir?: string[]
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value]
}

function getGlobalOptions(program: Command): { startDir?: string; overrides: ConfigOverrides } {
  const opts = program.opts<GlobalOptions>()
  return {
    startDir: opts.cwd,
    overrides: {
      modelProvider: opts.modelProvider,
      evaluatorModel: opts.evaluatorModel,
      skillsDir: opts.skillsDir?.length ? opts.skillsDir : undefined,
    },
  }
}

const dojo = new Command()
  .name('dojo')
  .description('Toolkit for testing and evaluating AI agent skills')
  .addHelpText('before', cliBanner)
  .option('--skills-dir <dir>', 'Override skills directory (repeatable)', collectOption, [])
  .option('--evaluator-model <model>', 'Override evaluator model')
  .option('--model-provider <provider>', 'Override model provider')
  .option('--cwd <dir>', 'Working directory for config and skill discovery')
  .version('0.1.0', '-v, --version', 'Output the current version')

dojo
  .command('run')
  .description('Run evals')
  .argument('[skill]', 'Filter by skill name (substring match)')
  .option('--type <type>', 'Filter by eval type (selection)')
  .option('--output <path>', 'Write combined report to file')
  .option('--inspect', 'Show full session telemetry and streaming output')
  .action(
    (skill: string | undefined, options: { type?: string; output?: string; inspect?: boolean }) => {
      const { startDir, overrides } = getGlobalOptions(dojo)
      return runCommand(skill, options, startDir, overrides)
    },
  )

dojo
  .command('list')
  .description('List discovered skills and evals')
  .action(() => {
    const { startDir, overrides } = getGlobalOptions(dojo)
    return listCommand(startDir, overrides)
  })

dojo
  .command('validate')
  .description('Validate skills and evals')
  .action(() => {
    const { startDir, overrides } = getGlobalOptions(dojo)
    return validateCommand(startDir, overrides)
  })

dojo.parse()
