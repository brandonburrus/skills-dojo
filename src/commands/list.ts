import { Command } from 'commander'
import { loadConfig, type ConfigOverrides } from '../loaders/config.js'
import { discoverSkills } from '../loaders/skill.js'
import { discoverSelectionFiles } from '../loaders/eval.js'
import { createTable, heading, truncate } from '../output/cli.js'
import { getGlobalOptions } from './globals.js'

export async function listCommand(startDir?: string, overrides?: ConfigOverrides): Promise<void> {
  const { config, configDir } = await loadConfig(startDir, overrides)
  const dirs = Array.isArray(config.skills.dir) ? config.skills.dir : [config.skills.dir]
  const skills = await discoverSkills(dirs, configDir)
  const selectionFiles = await discoverSelectionFiles(configDir, skills)

  console.log(heading('\nSkills'))
  if (skills.length === 0) {
    console.log('No skills found')
  } else {
    const skillTable = createTable(['Name', 'Description'])
    for (const skill of skills) {
      skillTable.push([skill.name, truncate(skill.description, 60)])
    }
    console.log(skillTable.toString())
  }

  const allEvals = selectionFiles.flatMap(sf =>
    sf.file.evals.map(e => ({ eval_: e, skillName: sf.skillName })),
  )

  console.log(heading('\nEvals'))
  if (allEvals.length === 0) {
    console.log('No evals found')
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
    console.log(evalTable.toString())
  }
}

export const list = new Command('list')
  .alias('ls')
  .description('List discovered skills and evals')
  .action(function (this: Command) {
    const { startDir, overrides } = getGlobalOptions(this)
    return listCommand(startDir, overrides)
  })
