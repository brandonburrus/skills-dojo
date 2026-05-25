import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stringify as toYaml } from 'yaml'
import { validateCommand } from '../../src/commands/validate.js'

describe('validateCommand', () => {
  let tmpDir: string
  let originalCwd: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dojo-validate-test-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)
    process.exitCode = undefined
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    process.exitCode = undefined
    logSpy.mockRestore()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('succeeds with valid project and no skills', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), '[model]\nprovider = "copilot"\n')

    await validateCommand()

    expect(process.exitCode).toBeUndefined()
    const output = logSpy.mock.calls.map(c => c[0] as string).join('\n')
    expect(output).toContain('Config loaded')
    expect(output).toContain('0 skills discovered')
    expect(output).toContain('0 selection evals validated')
  })

  it('succeeds with defaults when no config file exists', async () => {
    await validateCommand()

    expect(process.exitCode).toBeUndefined()
    const output = logSpy.mock.calls.map(c => c[0] as string).join('\n')
    expect(output).toContain('Config loaded')
    expect(output).toContain('using defaults')
  })

  it('discovers skills and evals', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), '[skills]\ndir = ["skills/"]\n')
    const skillDir = path.join(tmpDir, 'skills', 'my-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: my-skill\ndescription: A test skill\n---\n# My Skill\n',
    )

    const evalDir = path.join(skillDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(
      path.join(evalDir, 'selection.yaml'),
      toYaml({
        evals: [{ name: 'test-eval', prompt: 'Pick a skill', assert: ['my-skill'] }],
      }),
    )

    await validateCommand()

    expect(process.exitCode).toBeUndefined()
    const output = logSpy.mock.calls.map(c => c[0] as string).join('\n')
    expect(output).toContain('1 skill discovered')
    expect(output).toContain('1 selection eval validated')
  })

  it('reports error and sets exitCode for invalid skill', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), '[skills]\ndir = ["skills/"]\n')
    const skillDir = path.join(tmpDir, 'skills', 'bad-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: Bad-Skill\ndescription: Invalid name\n---\n# Bad\n',
    )

    await validateCommand()

    expect(process.exitCode).toBe(1)
    const output = logSpy.mock.calls.map(c => c[0] as string).join('\n')
    expect(output).toContain('Skill validation failed')
  })

  it('reports error for invalid TOML config', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), 'invalid toml [[[')

    await validateCommand()

    expect(process.exitCode).toBe(1)
    const output = logSpy.mock.calls.map(c => c[0] as string).join('\n')
    expect(output).toContain('Invalid TOML')
  })
})
