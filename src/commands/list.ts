import path from 'node:path'
import { Command } from 'commander'
import { loadConfig, type ConfigOverrides } from '../loaders/config.js'
import { discoverSkills } from '../loaders/skill.js'
import {
  discoverSelectionFiles,
  discoverEffectivenessFiles,
  discoverFixtures,
} from '../loaders/eval.js'
import { createTable, heading, truncate } from '../output/cli.js'
import { getGlobalOptions } from './globals.js'

interface ListOptions {
  json?: boolean
}

export async function listCommand(
  startDir?: string,
  overrides?: ConfigOverrides,
  configFile?: string,
  options?: ListOptions,
): Promise<void> {
  const { config, configDir } = await loadConfig(startDir, overrides, configFile)
  const dirs = Array.isArray(config.skills.dir) ? config.skills.dir : [config.skills.dir]
  const skills = await discoverSkills(dirs, configDir)
  const selectionFiles = await discoverSelectionFiles(configDir, skills)
  const effectivenessFiles = await discoverEffectivenessFiles(configDir, skills)

  const allEvals = selectionFiles.flatMap(sf =>
    sf.file.evals.map(e => ({ eval_: e, skillName: sf.skillName })),
  )

  const allEffEvals = await Promise.all(
    effectivenessFiles.map(async ef => {
      const skill = skills.find(s => s.name === ef.skillName)
      const fixtures = skill ? await discoverFixtures(path.join(skill.dirPath, 'evals')) : []
      return ef.file.evals.map(e => ({
        name: e.name,
        skillName: ef.skillName ?? 'root',
        fixtureCount: fixtures.length,
      }))
    }),
  ).then(results => results.flat())

  if (options?.json) {
    const output = {
      skills: skills.map(s => ({ name: s.name, description: s.description })),
      selectionEvals: allEvals.map(({ eval_, skillName }) => ({
        name: eval_.name,
        assert: eval_.assert
          ? Array.isArray(eval_.assert)
            ? eval_.assert
            : [eval_.assert]
          : [skillName ?? '(default)'],
        skill: skillName ?? 'root',
      })),
      effectivenessEvals: allEffEvals.map(e => ({
        name: e.name,
        skill: e.skillName,
        fixtureCount: e.fixtureCount,
      })),
    }
    console.log(JSON.stringify(output, null, 2))
    return
  }

  console.error(heading('\nSkills'))
  if (skills.length === 0) {
    console.error('No skills found')
  } else {
    const skillTable = createTable(['Name', 'Description'])
    for (const skill of skills) {
      skillTable.push([skill.name, truncate(skill.description, 60)])
    }
    console.error(skillTable.toString())
  }

  console.error(heading('\nSelection Evals'))
  if (allEvals.length === 0) {
    console.error('No evals found')
  } else {
    const evalTable = createTable(['Name', 'Assert', 'Skill'])
    for (const { eval_, skillName } of allEvals) {
      const assert = eval_.assert
        ? Array.isArray(eval_.assert)
          ? eval_.assert.join(', ')
          : eval_.assert
        : (skillName ?? '(default)')
      evalTable.push([eval_.name, assert, skillName ?? 'root'])
    }
    console.error(evalTable.toString())
  }

  console.error(heading('\nEffectiveness Evals'))
  if (allEffEvals.length === 0) {
    console.error('No effectiveness evals found')
  } else {
    const effTable = createTable(['Name', 'Skill', 'Fixtures'])
    for (const { name, skillName, fixtureCount } of allEffEvals) {
      effTable.push([name, skillName, String(fixtureCount)])
    }
    console.error(effTable.toString())
  }
}

export const list = new Command('list')
  .alias('ls')
  .description('List discovered skills and evals')
  .option('--json', 'Output as JSON to stdout')
  .action(function (this: Command, options: ListOptions) {
    const { startDir, configFile, overrides } = getGlobalOptions(this)
    return listCommand(startDir, overrides, configFile, options)
  })
