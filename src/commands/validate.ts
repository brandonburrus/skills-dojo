import { Command } from 'commander'
import chalk from 'chalk'
import {
  DojoError,
  ConfigValidationError,
  SkillValidationError,
  EvalValidationError,
} from '../errors.js'
import { loadConfig, type ConfigOverrides } from '../loaders/config.js'
import { discoverSkills } from '../loaders/skill.js'
import { discoverSelectionFiles, discoverEffectivenessFiles } from '../loaders/eval.js'
import { logSuccess, logFailure } from '../output/cli.js'
import type { DiscoveredSkill } from '../types.js'
import { getGlobalOptions } from './globals.js'

function formatError(error: DojoError): string {
  if (error instanceof ConfigValidationError) {
    const details = error.issues.map(i => `  ${i.path ? `${i.path}: ` : ''}${i.message}`).join('\n')
    return `${error.message}\n${details}`
  }
  if (error instanceof SkillValidationError) {
    return `Skill validation failed: ${error.skillPath}\n  ${error.message}`
  }
  if (error instanceof EvalValidationError) {
    return `Eval validation failed: ${error.evalPath}\n  ${error.message}`
  }
  return error.message
}

export async function validateCommand(
  startDir?: string,
  overrides?: ConfigOverrides,
  configFile?: string,
): Promise<void> {
  let hasErrors = false
  let configDir: string | undefined
  let skills: readonly DiscoveredSkill[] = []
  let evalCount = 0
  let effEvalCount = 0

  try {
    const result = await loadConfig(startDir, overrides, configFile)
    configDir = result.configDir

    const configSource = result.source === 'defaults' ? 'using defaults' : 'dojo.toml found'
    logSuccess(`Config loaded (${configSource})`)

    try {
      const dirs = Array.isArray(result.config.skills.dir)
        ? result.config.skills.dir
        : [result.config.skills.dir]
      skills = await discoverSkills(dirs, configDir)
      logSuccess(`${skills.length} skill${skills.length === 1 ? '' : 's'} discovered`)
    } catch (error) {
      if (error instanceof DojoError) {
        hasErrors = true
        logFailure(formatError(error))
      } else {
        throw error
      }
    }

    try {
      const selectionFiles = await discoverSelectionFiles(configDir, skills)
      evalCount = selectionFiles.reduce((sum, sf) => sum + sf.file.evals.length, 0)
      logSuccess(`${evalCount} selection eval${evalCount === 1 ? '' : 's'} validated`)
    } catch (error) {
      if (error instanceof DojoError) {
        hasErrors = true
        logFailure(formatError(error))
      } else {
        throw error
      }
    }

    try {
      const effectivenessFiles = await discoverEffectivenessFiles(configDir, skills)
      effEvalCount = effectivenessFiles.reduce((sum, ef) => sum + ef.file.evals.length, 0)
      logSuccess(`${effEvalCount} effectiveness eval${effEvalCount === 1 ? '' : 's'} validated`)
    } catch (error) {
      if (error instanceof DojoError) {
        hasErrors = true
        logFailure(formatError(error))
      } else {
        throw error
      }
    }
  } catch (error) {
    if (error instanceof DojoError) {
      hasErrors = true
      logFailure(formatError(error))
    } else {
      throw error
    }
  }

  if (!hasErrors) {
    console.error(
      chalk.blueBright(
        `\nValidated ${skills.length} skill${skills.length === 1 ? '' : 's'}, ${evalCount} selection eval${evalCount === 1 ? '' : 's'}, ${effEvalCount} effectiveness eval${effEvalCount === 1 ? '' : 's'}`,
      ),
    )
  }

  if (hasErrors) {
    process.exitCode = 1
  }
}

export const validate = new Command('validate')
  .description('Validate skills and evals')
  .action(function (this: Command) {
    const { startDir, configFile, overrides } = getGlobalOptions(this)
    return validateCommand(startDir, overrides, configFile)
  })
