import type { Command } from 'commander'
import type { ConfigOverrides } from '../loaders/config.js'
import type { GlobalOptions } from '../types.js'

export function getGlobalOptions(cmd: Command): {
  startDir?: string
  overrides: ConfigOverrides
} {
  const opts = cmd.optsWithGlobals<GlobalOptions>()
  return {
    startDir: opts.cwd,
    overrides: {
      modelProvider: opts.modelProvider,
      evaluatorModel: opts.evaluatorModel,
      skillsDir: opts.skillsDir?.length ? opts.skillsDir : undefined,
    },
  }
}
