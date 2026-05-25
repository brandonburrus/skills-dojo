import { Command } from 'commander'
import { run } from './commands/run.js'
import { list } from './commands/list.js'
import { validate } from './commands/validate.js'
import { dojoBanner } from './output/cli.js'

export type { GlobalOptions } from './types.js'

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value]
}

const dojo = new Command()
  .name('dojo')
  .description('Toolkit for testing and evaluating AI agent skills')
  .addHelpText('before', dojoBanner())
  .option('-s, --skills-dir <dir>', 'Override skills directory (repeatable)', collectOption, [])
  .option('-c, --config <path>', 'Path to config file (default: auto-detect dojo.toml)')
  .option('-d, --cwd <dir>', 'Working directory for config and skill discovery')
  .version('0.1.0', '-v, --version', 'Output the current version')

dojo.addCommand(run)
dojo.addCommand(list)
dojo.addCommand(validate)

dojo.parse()
