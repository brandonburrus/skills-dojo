import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stringify as toYaml } from 'yaml'
import { runCommand } from '../../src/commands/run.js'

vi.mock('../../src/providers/factory.js', () => ({
  createEvaluator: () => ({
    async runSelection() {
      return { loaded: true, skillName: 'my-skill', raw: 'loaded my-skill' }
    },
  }),
  createJudge: () => ({
    async evaluate() {
      return { perCriterion: [], overallPassed: true, judgeModel: 'mock' }
    },
  }),
}))

vi.mock('../../src/utils/run-id.js', () => ({
  generateRunId: vi.fn().mockReturnValue('contract-run-id'),
}))

async function createSkillAndEval(tmpDir: string, skillName: string): Promise<void> {
  await writeFile(path.join(tmpDir, 'dojo.toml'), `[skills]\ndir = ["skills/"]\n`)
  const skillDir = path.join(tmpDir, 'skills', skillName)
  await mkdir(skillDir, { recursive: true })
  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: A test skill\n---\n# ${skillName}\n`,
  )
  const evalDir = path.join(skillDir, 'evals')
  await mkdir(evalDir, { recursive: true })
  await writeFile(
    path.join(evalDir, 'selection.yaml'),
    toYaml({
      evals: [{ name: 'test-eval', prompt: 'Pick a skill', assert: [skillName] }],
    }),
  )
}

async function createFailingSkillAndEval(tmpDir: string): Promise<void> {
  await writeFile(path.join(tmpDir, 'dojo.toml'), `[skills]\ndir = ["skills/"]\n`)
  const skillDir = path.join(tmpDir, 'skills', 'wrong-skill')
  await mkdir(skillDir, { recursive: true })
  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: wrong-skill\ndescription: A test skill\n---\n# wrong-skill\n`,
  )
  const evalDir = path.join(skillDir, 'evals')
  await mkdir(evalDir, { recursive: true })
  // Assert expects 'other-skill' but mock returns 'my-skill'
  await writeFile(
    path.join(evalDir, 'selection.yaml'),
    toYaml({
      evals: [{ name: 'fail-eval', prompt: 'Pick a skill', assert: ['other-skill'] }],
    }),
  )
}

describe('runCommand contract', () => {
  let tmpDir: string
  let originalCwd: string
  let stderrSpy: ReturnType<typeof vi.spyOn>
  let stdoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dojo-run-contract-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)
    process.exitCode = undefined
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    process.exitCode = undefined
    stderrSpy.mockRestore()
    stdoutSpy.mockRestore()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('does not set exitCode when all evals pass', async () => {
    await createSkillAndEval(tmpDir, 'my-skill')

    await runCommand(undefined, {})

    expect(process.exitCode).toBeUndefined()
  })

  it('sets exitCode to 1 when evals fail', async () => {
    await createFailingSkillAndEval(tmpDir)

    await runCommand(undefined, {})

    expect(process.exitCode).toBe(1)
  })

  it('outputs valid JSON to stdout when --json flag is set', async () => {
    await createSkillAndEval(tmpDir, 'my-skill')

    await runCommand(undefined, { json: true })

    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    const jsonStr = calls.join('')
    const parsed = JSON.parse(jsonStr)
    expect(parsed).toHaveProperty('runId')
    expect(parsed).toHaveProperty('timestamp')
    expect(parsed).toHaveProperty('selection')
    expect(parsed).toHaveProperty('effectiveness')
    expect(Array.isArray(parsed.selection)).toBe(true)
    expect(Array.isArray(parsed.effectiveness)).toBe(true)
  })

  it('suppresses banner and run ID heading when --quiet is set', async () => {
    await createSkillAndEval(tmpDir, 'my-skill')

    await runCommand(undefined, { quiet: true })

    const output = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).not.toContain('Starting run:')
    expect(output).not.toContain('dojo')
  })

  it('includes "Completed in" timing output in stderr', async () => {
    await createSkillAndEval(tmpDir, 'my-skill')

    await runCommand(undefined, {})

    const output = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).toContain('Completed in')
  })

  it('writes report JSON with correct schema shape', async () => {
    await createSkillAndEval(tmpDir, 'my-skill')

    await runCommand(undefined, {})

    const reportPath = path.join(
      tmpDir,
      'skills',
      'my-skill',
      'evals',
      'reports',
      'contract-run-id',
      'report.json',
    )
    const report = JSON.parse(await readFile(reportPath, 'utf-8'))
    expect(report).toHaveProperty('runId', 'contract-run-id')
    expect(report).toHaveProperty('timestamp')
    expect(report).toHaveProperty('skill', 'my-skill')
    expect(report).toHaveProperty('totalEvals')
    expect(report).toHaveProperty('passed')
    expect(report).toHaveProperty('failed')
    expect(report).toHaveProperty('results')
    expect(Array.isArray(report.results)).toBe(true)
    expect(report.results.length).toBeGreaterThan(0)
  })
})
