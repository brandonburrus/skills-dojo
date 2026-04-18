import { readdir, readFile, stat } from 'node:fs/promises'
import { join, basename, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { SkillFrontmatterSchema } from '../schemas/skill.js'
import { SkillValidationError } from '../errors.js'
import type { DiscoveredSkill } from '../types.js'

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/

export function parseFrontmatter(content: string): Record<string, unknown> {
  const match = FRONTMATTER_REGEX.exec(content)
  if (!match) {
    throw new Error('No frontmatter found')
  }
  const parsed: unknown = parseYaml(match[1])
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Frontmatter must be a YAML mapping')
  }
  return parsed as Record<string, unknown>
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function loadSkill(skillDir: string): Promise<DiscoveredSkill> {
  const skillMdPath = join(skillDir, 'SKILL.md')
  const content = await readFile(skillMdPath, 'utf-8')

  let raw: Record<string, unknown>
  try {
    raw = parseFrontmatter(content)
  } catch (error) {
    throw new SkillValidationError(`Failed to parse frontmatter in ${skillMdPath}`, skillMdPath, {
      cause: error,
    })
  }

  const result = SkillFrontmatterSchema.safeParse(raw)
  if (!result.success) {
    throw new SkillValidationError(
      `Invalid frontmatter in ${skillMdPath}: ${result.error.message}`,
      skillMdPath,
      { cause: result.error },
    )
  }

  const frontmatter = result.data
  const dirName = basename(skillDir)
  if (frontmatter.name !== dirName) {
    throw new SkillValidationError(
      `Skill name "${frontmatter.name}" does not match directory name "${dirName}"`,
      skillMdPath,
    )
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    dirPath: skillDir,
    frontmatter,
  }
}

export async function discoverSkills(
  skillPaths: readonly string[],
  configDir: string,
): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = []

  for (const skillPath of skillPaths) {
    const resolvedPath = resolve(configDir, skillPath)
    if (!(await pathExists(resolvedPath))) {
      continue
    }

    const entries = await readdir(resolvedPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillDir = join(resolvedPath, entry.name)
      const skillMdPath = join(skillDir, 'SKILL.md')
      if (!(await pathExists(skillMdPath))) continue
      skills.push(await loadSkill(skillDir))
    }
  }

  return skills
}
