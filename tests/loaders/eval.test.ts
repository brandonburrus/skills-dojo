import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stringify as toYaml } from 'yaml'
import { EvalValidationError } from '../../src/errors.js'
import { discoverEvals } from '../../src/loaders/eval.js'
import type { DiscoveredSkill, SkillFrontmatter } from '../../src/types.js'

const validEval = {
  name: 'test eval',
  type: 'selection' as const,
  prompt: 'Pick the right skill',
  selection: {
    expect: 'my-skill',
    available: ['my-skill', 'other-skill'],
  },
}

function makeSkill(dirPath: string): DiscoveredSkill {
  return {
    name: 'test-skill',
    description: 'A test skill',
    dirPath,
    frontmatter: { name: 'test-skill', description: 'A test skill' } as SkillFrontmatter,
  }
}

describe('discoverEvals', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(tmpdir(), `dojo-eval-test-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('discovers a single eval from a YAML file', async () => {
    const evalDir = path.join(tmpDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(path.join(evalDir, 'test.yaml'), toYaml(validEval))

    const results = await discoverEvals(tmpDir, [])
    expect(results).toHaveLength(1)
    expect(results[0].eval.name).toBe('test eval')
  })

  it('discovers an array of evals from one YAML file', async () => {
    const evalDir = path.join(tmpDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    const second = { ...validEval, name: 'second eval' }
    await writeFile(path.join(evalDir, 'multi.yaml'), toYaml([validEval, second]))

    const results = await discoverEvals(tmpDir, [])
    expect(results).toHaveLength(2)
    expect(results.map(r => r.eval.name)).toEqual(['test eval', 'second eval'])
  })

  it('discovers evals from per-skill evals dir', async () => {
    const skillDir = path.join(tmpDir, 'skills', 'my-skill')
    const evalDir = path.join(skillDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(path.join(evalDir, 'test.yaml'), toYaml(validEval))

    const results = await discoverEvals(tmpDir, [makeSkill(skillDir)])
    expect(results).toHaveLength(1)
  })

  it('discovers evals from root evals dir', async () => {
    const evalDir = path.join(tmpDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(path.join(evalDir, 'root.yaml'), toYaml(validEval))

    const results = await discoverEvals(tmpDir, [])
    expect(results).toHaveLength(1)
    expect(results[0].filePath).toContain('root.yaml')
  })

  it('merges evals from both per-skill and root dirs', async () => {
    const skillDir = path.join(tmpDir, 'skills', 'my-skill')
    const skillEvalDir = path.join(skillDir, 'evals')
    const rootEvalDir = path.join(tmpDir, 'evals')
    await mkdir(skillEvalDir, { recursive: true })
    await mkdir(rootEvalDir, { recursive: true })
    await writeFile(
      path.join(skillEvalDir, 'skill.yaml'),
      toYaml({ ...validEval, name: 'skill one' }),
    )
    await writeFile(path.join(rootEvalDir, 'root.yaml'), toYaml({ ...validEval, name: 'root one' }))

    const results = await discoverEvals(tmpDir, [makeSkill(skillDir)])
    expect(results).toHaveLength(2)
    expect(results.map(r => r.eval.name)).toEqual(['skill one', 'root one'])
  })

  it('silently skips missing evals directories', async () => {
    const results = await discoverEvals(tmpDir, [makeSkill(path.join(tmpDir, 'nonexistent'))])
    expect(results).toEqual([])
  })

  it('throws EvalValidationError for invalid YAML content', async () => {
    const evalDir = path.join(tmpDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(path.join(evalDir, 'bad.yaml'), toYaml({ name: 'bad', type: 'unknown' }))

    await expect(discoverEvals(tmpDir, [])).rejects.toThrow(EvalValidationError)
  })

  it('discovers both .yaml and .yml extensions', async () => {
    const evalDir = path.join(tmpDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(path.join(evalDir, 'one.yaml'), toYaml({ ...validEval, name: 'yaml ext' }))
    await writeFile(path.join(evalDir, 'two.yml'), toYaml({ ...validEval, name: 'yml ext' }))

    const results = await discoverEvals(tmpDir, [])
    expect(results).toHaveLength(2)
  })
})
