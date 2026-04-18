import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../../src/commands/run.js'

vi.mock('../../src/providers/copilot/evaluator.js', () => ({
  CopilotEvaluator: class {
    async runSelection() {
      return { loaded: true, skillName: 'my-skill', raw: 'loaded my-skill' }
    }
  },
}))

vi.mock('../../src/utils/run-id.js', () => ({
  generateRunId: vi.fn().mockReturnValue('test-run-id'),
}))

async function createSkillAndEval(
  tmpDir: string,
  skillName: string,
  evalType: string,
  expect_: string,
): Promise<void> {
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
    path.join(evalDir, 'test.yaml'),
    `name: test-eval\ntype: ${evalType}\nprompt: Pick a skill\nselection:\n  expect: ${expect_}\n  available:\n    - ${skillName}\n`,
  )
}

describe('runCommand', () => {
  let tmpDir: string
  let originalCwd: string
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dojo-run-test-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    stderrSpy.mockRestore()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('runs evals and writes report JSON', async () => {
    await createSkillAndEval(tmpDir, 'my-skill', 'selection', 'my-skill')

    await runCommand(undefined, {})

    const reportPath = path.join(
      tmpDir,
      'skills',
      'my-skill',
      'evals',
      'reports',
      'test-run-id',
      'report.json',
    )
    const report = JSON.parse(await readFile(reportPath, 'utf-8'))
    expect(report.runId).toBe('test-run-id')
    expect(report.skill).toBe('my-skill')
    expect(report.totalEvals).toBe(1)
    expect(report.passed).toBe(1)
    expect(report.failed).toBe(0)
    expect(report.results).toHaveLength(1)
  })

  it('writes combined report when --output is provided', async () => {
    await createSkillAndEval(tmpDir, 'my-skill', 'selection', 'my-skill')
    const outputPath = path.join(tmpDir, 'combined.json')

    await runCommand(undefined, { output: outputPath })

    const combined = JSON.parse(await readFile(outputPath, 'utf-8'))
    expect(combined.results).toHaveLength(1)
  })

  it('filters by --type', async () => {
    await createSkillAndEval(tmpDir, 'my-skill', 'selection', 'my-skill')

    await runCommand(undefined, { type: 'nonexistent' })

    const output = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).toContain('No evals found')
  })

  it('prints message when no evals found', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), `[skills]\ndir = ["skills/"]\n`)

    await runCommand(undefined, {})

    const output = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).toContain('No evals found')
  })

  it('filters evals by skill name', async () => {
    await createSkillAndEval(tmpDir, 'my-skill', 'selection', 'my-skill')

    await runCommand('my-skill', {})

    const reportPath = path.join(
      tmpDir,
      'skills',
      'my-skill',
      'evals',
      'reports',
      'test-run-id',
      'report.json',
    )
    const report = JSON.parse(await readFile(reportPath, 'utf-8'))
    expect(report.skill).toBe('my-skill')
    expect(report.totalEvals).toBe(1)
  })

  it('prints no evals when skill filter matches nothing', async () => {
    await createSkillAndEval(tmpDir, 'my-skill', 'selection', 'my-skill')

    await runCommand('nonexistent', {})

    const output = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).toContain('No evals found')
  })
})
