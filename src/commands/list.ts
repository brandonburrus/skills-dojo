import { loadConfig, type ConfigOverrides } from '../loaders/config.js'
import { discoverSkills } from '../loaders/skill.js'
import { discoverEvals } from '../loaders/eval.js'
import { createTable, heading, truncate } from '../output/cli.js'

export async function listCommand(startDir?: string, overrides?: ConfigOverrides): Promise<void> {
  const { config, configDir } = await loadConfig(startDir, overrides)
  const dirs = Array.isArray(config.skills.dir) ? config.skills.dir : [config.skills.dir]
  const skills = await discoverSkills(dirs, configDir)
  const evals = await discoverEvals(configDir, skills)

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

  console.log(heading('\nEvals'))
  if (evals.length === 0) {
    console.log('No evals found')
  } else {
    const evalTable = createTable(['Name', 'Type', 'Expect', 'Skill'])
    for (const { eval: eval_, skillName } of evals) {
      evalTable.push([eval_.name, eval_.type, eval_.selection.expect, skillName ?? 'root'])
    }
    console.log(evalTable.toString())
  }
}
