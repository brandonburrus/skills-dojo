import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stringify as toYaml } from 'yaml'
import { EvalValidationError } from '../../src/errors.js'
import { discoverSelectionFiles, discoverVariants } from '../../src/loaders/eval.js'
import type { DiscoveredSkill, SkillFrontmatter } from '../../src/types.js'

const validSelectionFile = {
  evals: [{ name: 'test-eval', prompt: 'Pick the right skill' }],
}

function makeSkill(dirPath: string, name = 'test-skill'): DiscoveredSkill {
  return {
    name,
    description: 'A test skill',
    dirPath,
    frontmatter: { name, description: 'A test skill' } as SkillFrontmatter,
  }
}

describe('discoverSelectionFiles', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(tmpdir(), `dojo-eval-test-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('discovers selection.yaml from skill evals dir', async () => {
    const skillDir = path.join(tmpDir, 'skills', 'my-skill')
    const evalDir = path.join(skillDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(path.join(evalDir, 'selection.yaml'), toYaml(validSelectionFile))

    const results = await discoverSelectionFiles(tmpDir, [makeSkill(skillDir)])
    expect(results).toHaveLength(1)
    expect(results[0].skillName).toBe('test-skill')
    expect(results[0].file.evals).toHaveLength(1)
  })

  it('discovers selection.yml', async () => {
    const skillDir = path.join(tmpDir, 'skills', 'my-skill')
    const evalDir = path.join(skillDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(path.join(evalDir, 'selection.yml'), toYaml(validSelectionFile))

    const results = await discoverSelectionFiles(tmpDir, [makeSkill(skillDir)])
    expect(results).toHaveLength(1)
  })

  it('discovers from root evals dir', async () => {
    const evalDir = path.join(tmpDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(path.join(evalDir, 'selection.yaml'), toYaml(validSelectionFile))

    const results = await discoverSelectionFiles(tmpDir, [])
    expect(results).toHaveLength(1)
    expect(results[0].skillName).toBeNull()
  })

  it('discovers from both skill and root dirs', async () => {
    const skillDir = path.join(tmpDir, 'skills', 'my-skill')
    const skillEvalDir = path.join(skillDir, 'evals')
    const rootEvalDir = path.join(tmpDir, 'evals')
    await mkdir(skillEvalDir, { recursive: true })
    await mkdir(rootEvalDir, { recursive: true })
    await writeFile(path.join(skillEvalDir, 'selection.yaml'), toYaml(validSelectionFile))
    await writeFile(path.join(rootEvalDir, 'selection.yaml'), toYaml(validSelectionFile))

    const results = await discoverSelectionFiles(tmpDir, [makeSkill(skillDir)])
    expect(results).toHaveLength(2)
  })

  it('returns empty for missing dirs', async () => {
    const results = await discoverSelectionFiles(tmpDir, [
      makeSkill(path.join(tmpDir, 'nonexistent')),
    ])
    expect(results).toEqual([])
  })

  it('throws EvalValidationError for invalid YAML', async () => {
    const evalDir = path.join(tmpDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(path.join(evalDir, 'selection.yaml'), '{{invalid yaml')

    await expect(discoverSelectionFiles(tmpDir, [])).rejects.toThrow(EvalValidationError)
  })

  it('throws EvalValidationError for schema validation failure', async () => {
    const evalDir = path.join(tmpDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(path.join(evalDir, 'selection.yaml'), toYaml({ notValid: true }))

    await expect(discoverSelectionFiles(tmpDir, [])).rejects.toThrow(EvalValidationError)
  })

  it('parses top-level variants and evals correctly', async () => {
    const fileWithVariants = {
      variants: [{ name: 'v1', value: 'variant content' }],
      evals: [
        {
          name: 'test-eval',
          prompt: 'Pick the right skill',
          variants: ['v1'],
        },
      ],
    }
    const evalDir = path.join(tmpDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(path.join(evalDir, 'selection.yaml'), toYaml(fileWithVariants))

    const results = await discoverSelectionFiles(tmpDir, [])
    expect(results).toHaveLength(1)
    expect(results[0].file.variants).toHaveLength(1)
    expect(results[0].file.variants![0].name).toBe('v1')
    expect(results[0].file.evals[0].variants).toEqual(['v1'])
  })
})

describe('discoverVariants', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(tmpdir(), `dojo-variant-test-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns empty array when variants dir does not exist', async () => {
    const result = await discoverVariants(path.join(tmpDir, 'nonexistent'))
    expect(result).toEqual([])
  })

  it('discovers valid variant with SKILL.md', async () => {
    const variantsDir = path.join(tmpDir, 'variants', 'my-variant')
    await mkdir(variantsDir, { recursive: true })
    await writeFile(
      path.join(variantsDir, 'SKILL.md'),
      `---\nname: my-variant\ndescription: A test variant\n---\n\n# Test`,
    )

    const result = await discoverVariants(tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('my-variant')
    expect(result[0].description).toBe('A test variant')
    expect(result[0].dirPath).toBe(variantsDir)
  })

  it('skips directories without SKILL.md', async () => {
    const variantsDir = path.join(tmpDir, 'variants', 'no-skill')
    await mkdir(variantsDir, { recursive: true })
    await writeFile(path.join(variantsDir, 'README.md'), '# Not a skill')

    const result = await discoverVariants(tmpDir)
    expect(result).toEqual([])
  })

  it('warns and skips variant with invalid frontmatter', async () => {
    const variantsDir = path.join(tmpDir, 'variants', 'bad-variant')
    await mkdir(variantsDir, { recursive: true })
    await writeFile(path.join(variantsDir, 'SKILL.md'), `---\nname: INVALID NAME!\n---\n\n# Bad`)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await discoverVariants(tmpDir)
    expect(result).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bad-variant'))
    warnSpy.mockRestore()
  })

  it('uses directory name as variant ID regardless of frontmatter name', async () => {
    const variantsDir = path.join(tmpDir, 'variants', 'dir-name')
    await mkdir(variantsDir, { recursive: true })
    await writeFile(
      path.join(variantsDir, 'SKILL.md'),
      `---\nname: different-name\ndescription: Test\n---\n\n# Test`,
    )

    const result = await discoverVariants(tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('dir-name')
  })
})
