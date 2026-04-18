import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stringify as toYaml } from 'yaml'
import { EvalValidationError } from '../../src/errors.js'
import { discoverVariants } from '../../src/loaders/variant.js'
import type { DiscoveredSkill, SkillFrontmatter } from '../../src/types.js'

function makeSkill(dirPath: string, name = 'test-skill'): DiscoveredSkill {
  return {
    name,
    description: `${name} description`,
    dirPath,
    frontmatter: { name, description: `${name} description` } as SkillFrontmatter,
  }
}

describe('discoverVariants', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(tmpdir(), `dojo-variant-test-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('discovers variants from skill evals/variants/ dir', async () => {
    const variantsDir = path.join(tmpDir, 'evals', 'variants')
    await mkdir(variantsDir, { recursive: true })
    await writeFile(
      path.join(variantsDir, 'v.yaml'),
      toYaml({ name: 'concise', description: 'Short desc' }),
    )

    const results = await discoverVariants([makeSkill(tmpDir)])
    expect(results).toHaveLength(1)
    expect(results[0].variants).toHaveLength(1)
    expect(results[0].variants[0].name).toBe('concise')
  })

  it('returns empty when no variants dir exists', async () => {
    const results = await discoverVariants([makeSkill(path.join(tmpDir, 'nonexistent'))])
    expect(results).toEqual([])
  })

  it('handles single variant object (not array)', async () => {
    const variantsDir = path.join(tmpDir, 'evals', 'variants')
    await mkdir(variantsDir, { recursive: true })
    await writeFile(
      path.join(variantsDir, 'single.yaml'),
      toYaml({ name: 'single', description: 'One variant' }),
    )

    const results = await discoverVariants([makeSkill(tmpDir)])
    expect(results).toHaveLength(1)
    expect(results[0].variants).toHaveLength(1)
  })

  it('handles array of variants', async () => {
    const variantsDir = path.join(tmpDir, 'evals', 'variants')
    await mkdir(variantsDir, { recursive: true })
    await writeFile(
      path.join(variantsDir, 'multi.yaml'),
      toYaml([
        { name: 'v1', description: 'First' },
        { name: 'v2', description: 'Second' },
      ]),
    )

    const results = await discoverVariants([makeSkill(tmpDir)])
    expect(results).toHaveLength(1)
    expect(results[0].variants).toHaveLength(2)
  })

  it('throws on invalid YAML', async () => {
    const variantsDir = path.join(tmpDir, 'evals', 'variants')
    await mkdir(variantsDir, { recursive: true })
    await writeFile(path.join(variantsDir, 'bad.yaml'), ':\n  :\n    - ][')

    await expect(discoverVariants([makeSkill(tmpDir)])).rejects.toThrow(EvalValidationError)
  })

  it('throws on schema validation failure', async () => {
    const variantsDir = path.join(tmpDir, 'evals', 'variants')
    await mkdir(variantsDir, { recursive: true })
    await writeFile(path.join(variantsDir, 'invalid.yaml'), toYaml({ name: 'ok', description: '' }))

    await expect(discoverVariants([makeSkill(tmpDir)])).rejects.toThrow(EvalValidationError)
  })

  it('skips null/empty files', async () => {
    const variantsDir = path.join(tmpDir, 'evals', 'variants')
    await mkdir(variantsDir, { recursive: true })
    await writeFile(path.join(variantsDir, 'empty.yaml'), '')

    const results = await discoverVariants([makeSkill(tmpDir)])
    expect(results).toEqual([])
  })

  it('discovers variants from evals/variants.yaml single file', async () => {
    const evalsDir = path.join(tmpDir, 'evals')
    await mkdir(evalsDir, { recursive: true })
    await writeFile(
      path.join(evalsDir, 'variants.yaml'),
      toYaml([
        { name: 'flat-v1', description: 'From flat file' },
        { name: 'flat-v2', description: 'Also from flat file' },
      ]),
    )

    const results = await discoverVariants([makeSkill(tmpDir)])
    expect(results).toHaveLength(1)
    expect(results[0].variants).toHaveLength(2)
    expect(results[0].variants[0].name).toBe('flat-v1')
  })

  it('combines evals/variants.yaml and evals/variants/ directory', async () => {
    const evalsDir = path.join(tmpDir, 'evals')
    const variantsDir = path.join(evalsDir, 'variants')
    await mkdir(variantsDir, { recursive: true })

    await writeFile(
      path.join(evalsDir, 'variants.yaml'),
      toYaml({ name: 'from-file', description: 'Single file variant' }),
    )
    await writeFile(
      path.join(variantsDir, 'dir.yaml'),
      toYaml({ name: 'from-dir', description: 'Directory variant' }),
    )

    const results = await discoverVariants([makeSkill(tmpDir)])
    expect(results).toHaveLength(2)
    const allNames = results.flatMap(r => r.variants.map(v => v.name))
    expect(allNames).toContain('from-file')
    expect(allNames).toContain('from-dir')
  })
})
