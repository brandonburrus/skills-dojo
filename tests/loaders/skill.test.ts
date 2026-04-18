import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { parseFrontmatter, discoverSkills } from '../../src/loaders/skill.js'
import { SkillValidationError } from '../../src/errors.js'

const VALID_FRONTMATTER = `---
name: my-skill
description: A useful skill
---

# My Skill

Some content here.`

function makeSkillMd(name: string, description = 'A useful skill'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

describe('parseFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const result = parseFrontmatter(VALID_FRONTMATTER)
    expect(result).toEqual({ name: 'my-skill', description: 'A useful skill' })
  })

  it('throws on missing frontmatter', () => {
    expect(() => parseFrontmatter('# No frontmatter here')).toThrow('No frontmatter found')
  })

  it('throws when no closing ---', () => {
    expect(() => parseFrontmatter('---\nname: test\n')).toThrow('No frontmatter found')
  })

  it('parses frontmatter ignoring extra content after closing ---', () => {
    const content = '---\nname: test\n---\nExtra content\nMore content'
    const result = parseFrontmatter(content)
    expect(result).toEqual({ name: 'test' })
  })
})

describe('discoverSkills', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'dojo-skill-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  async function createSkillDir(basePath: string, name: string, content?: string): Promise<void> {
    const skillDir = join(basePath, name)
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), content ?? makeSkillMd(name))
  }

  it('discovers a single valid skill', async () => {
    const skillsDir = join(tmpDir, 'skills')
    await mkdir(skillsDir)
    await createSkillDir(skillsDir, 'my-skill')

    const result = await discoverSkills(['skills'], tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      name: 'my-skill',
      description: 'A useful skill',
      dirPath: join(skillsDir, 'my-skill'),
      frontmatter: { name: 'my-skill', description: 'A useful skill' },
    })
  })

  it('discovers multiple skills in one path', async () => {
    const skillsDir = join(tmpDir, 'skills')
    await mkdir(skillsDir)
    await createSkillDir(skillsDir, 'skill-a')
    await createSkillDir(skillsDir, 'skill-b')

    const result = await discoverSkills(['skills'], tmpDir)
    expect(result).toHaveLength(2)
    const names = result.map(s => s.name).sort()
    expect(names).toEqual(['skill-a', 'skill-b'])
  })

  it('silently skips missing paths', async () => {
    const result = await discoverSkills(['nonexistent'], tmpDir)
    expect(result).toEqual([])
  })

  it('throws SkillValidationError on name mismatch', async () => {
    const skillsDir = join(tmpDir, 'skills')
    await mkdir(skillsDir)
    await createSkillDir(skillsDir, 'my-skill', makeSkillMd('wrong-name'))

    await expect(discoverSkills(['skills'], tmpDir)).rejects.toThrow(SkillValidationError)
    await expect(discoverSkills(['skills'], tmpDir)).rejects.toThrow(
      /does not match directory name/,
    )
  })

  it('throws SkillValidationError on invalid frontmatter', async () => {
    const skillsDir = join(tmpDir, 'skills')
    await mkdir(skillsDir)
    await createSkillDir(skillsDir, 'bad-skill', '---\nname: bad-skill\n---\n')

    await expect(discoverSkills(['skills'], tmpDir)).rejects.toThrow(SkillValidationError)
  })

  it('returns skills from valid paths while skipping missing ones', async () => {
    const skillsDir = join(tmpDir, 'skills')
    await mkdir(skillsDir)
    await createSkillDir(skillsDir, 'real-skill')

    const result = await discoverSkills(['nonexistent', 'skills', 'also-missing'], tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('real-skill')
  })
})
