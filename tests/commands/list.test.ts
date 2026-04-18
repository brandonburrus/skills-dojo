import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { listCommand } from '../../src/commands/list.js'
import * as configLoader from '../../src/loaders/config.js'

function makeSkillMd(name: string, description = 'A useful skill'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

function makeEvalYaml(name: string, expect_skill: string): string {
  return [
    `name: ${name}`,
    'type: selection',
    'prompt: Pick the right skill',
    'selection:',
    `  expect: ${expect_skill}`,
    '  available: all',
  ].join('\n')
}

describe('listCommand', () => {
  let tmpDir: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'dojo-list-test-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy.mockRestore()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('prints tables when skills and evals exist', async () => {
    const skillsDir = join(tmpDir, 'skills', 'my-skill')
    const evalsDir = join(skillsDir, 'evals')
    await mkdir(evalsDir, { recursive: true })
    await writeFile(join(skillsDir, 'SKILL.md'), makeSkillMd('my-skill', 'Does things'))
    await writeFile(join(evalsDir, 'test.yaml'), makeEvalYaml('pick-skill', 'my-skill'))

    vi.spyOn(configLoader, 'loadConfig').mockResolvedValue({
      config: {
        skills: { dir: ['skills/'] },
        model: { provider: 'copilot', evaluator: 'gpt-4o-mini', judge: 'gpt-4o-mini' },
        reporting: { 'per-skill': true, consolidated: false },
      },
      configDir: tmpDir,
    })

    await listCommand()

    const output = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).toContain('my-skill')
    expect(output).toContain('Does things')
    expect(output).toContain('pick-skill')
    expect(output).toContain('selection')
  })

  it('prints "No skills found" for empty project', async () => {
    vi.spyOn(configLoader, 'loadConfig').mockResolvedValue({
      config: {
        skills: { dir: ['skills/'] },
        model: { provider: 'copilot', evaluator: 'gpt-4o-mini', judge: 'gpt-4o-mini' },
        reporting: { 'per-skill': true, consolidated: false },
      },
      configDir: tmpDir,
    })

    await listCommand()

    const output = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).toContain('No skills found')
    expect(output).toContain('No evals found')
  })
})
