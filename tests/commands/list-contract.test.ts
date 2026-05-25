import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { stringify as toYaml } from 'yaml'
import { listCommand } from '../../src/commands/list.js'
import * as configLoader from '../../src/loaders/config.js'

function makeSkillMd(name: string, description = 'A useful skill'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

function makeSelectionYaml(evalName: string, assertSkill: string): string {
  return toYaml({
    evals: [{ name: evalName, prompt: 'Pick the right skill', assert: [assertSkill] }],
  })
}

function mockConfig(tmpDir: string) {
  vi.spyOn(configLoader, 'loadConfig').mockResolvedValue({
    config: {
      skills: { dir: ['skills/'] },
      model: { provider: 'copilot', evaluator: 'gpt-4o-mini', judge: 'gpt-4o-mini' },
      reporting: { perSkill: true, consolidated: false },
      effectiveness: { warnFixtureThreshold: 4, confirmFixtureThreshold: 12 },
    },
    configDir: tmpDir,
    source: 'file',
  })
}

describe('listCommand contract', () => {
  let tmpDir: string
  let stderrSpy: ReturnType<typeof vi.spyOn>
  let stdoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'dojo-list-contract-'))
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    stderrSpy.mockRestore()
    stdoutSpy.mockRestore()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('sends human-readable output to stderr (console.error)', async () => {
    const skillsDir = join(tmpDir, 'skills', 'my-skill')
    const evalsDir = join(skillsDir, 'evals')
    await mkdir(evalsDir, { recursive: true })
    await writeFile(join(skillsDir, 'SKILL.md'), makeSkillMd('my-skill', 'Does things'))
    await writeFile(join(evalsDir, 'selection.yaml'), makeSelectionYaml('pick-skill', 'my-skill'))
    mockConfig(tmpDir)

    await listCommand()

    const stderrOutput = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(stderrOutput).toContain('my-skill')
    expect(stderrOutput).toContain('Does things')
    // stdout should NOT have received table output
    expect(stdoutSpy).not.toHaveBeenCalled()
  })

  it('outputs valid JSON to stdout when --json option is set', async () => {
    const skillsDir = join(tmpDir, 'skills', 'my-skill')
    const evalsDir = join(skillsDir, 'evals')
    await mkdir(evalsDir, { recursive: true })
    await writeFile(join(skillsDir, 'SKILL.md'), makeSkillMd('my-skill', 'Does things'))
    await writeFile(join(evalsDir, 'selection.yaml'), makeSelectionYaml('pick-skill', 'my-skill'))
    mockConfig(tmpDir)

    await listCommand(undefined, undefined, undefined, { json: true })

    const jsonStr = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(jsonStr)
    expect(parsed).toHaveProperty('skills')
    expect(parsed).toHaveProperty('selectionEvals')
    expect(parsed).toHaveProperty('effectivenessEvals')
    expect(parsed.skills[0]).toHaveProperty('name', 'my-skill')
    expect(parsed.skills[0]).toHaveProperty('description', 'Does things')
    expect(parsed.selectionEvals[0]).toHaveProperty('name', 'pick-skill')
    expect(parsed.selectionEvals[0]).toHaveProperty('assert')
    expect(parsed.selectionEvals[0]).toHaveProperty('skill')
  })

  it('prints "No skills found" and "No evals found" for empty project', async () => {
    mockConfig(tmpDir)

    await listCommand()

    const output = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).toContain('No skills found')
    expect(output).toContain('No evals found')
    expect(output).toContain('No effectiveness evals found')
  })

  it('contains skill names and eval names in output', async () => {
    const skillsDir = join(tmpDir, 'skills', 'sql-queries')
    const evalsDir = join(skillsDir, 'evals')
    await mkdir(evalsDir, { recursive: true })
    await writeFile(join(skillsDir, 'SKILL.md'), makeSkillMd('sql-queries', 'Write SQL'))
    await writeFile(join(evalsDir, 'selection.yaml'), makeSelectionYaml('pick-sql', 'sql-queries'))
    mockConfig(tmpDir)

    await listCommand()

    const output = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).toContain('sql-queries')
    expect(output).toContain('pick-sql')
  })
})
