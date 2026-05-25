import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stringify as toYaml } from 'yaml'
import { validateCommand } from '../../src/commands/validate.js'

describe('validateCommand contract', () => {
  let tmpDir: string
  let originalCwd: string
  let logSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dojo-validate-contract-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)
    process.exitCode = undefined
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    process.exitCode = undefined
    logSpy.mockRestore()
    stderrSpy.mockRestore()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('does not set exitCode for a valid project', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), '[model]\nprovider = "copilot"\n')
    const skillDir = path.join(tmpDir, 'skills', 'good-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: good-skill\ndescription: Valid skill\n---\n# Good\n',
    )
    const evalDir = path.join(skillDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(
      path.join(evalDir, 'selection.yaml'),
      toYaml({ evals: [{ name: 'e1', prompt: 'Pick', assert: ['good-skill'] }] }),
    )

    await validateCommand()

    expect(process.exitCode).toBeUndefined()
  })

  it('sets exitCode to 1 for invalid skill', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), '[skills]\ndir = ["skills/"]\n')
    const skillDir = path.join(tmpDir, 'skills', 'bad-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: Bad-Skill\ndescription: Invalid name\n---\n# Bad\n',
    )

    await validateCommand()

    expect(process.exitCode).toBe(1)
  })

  it('sets exitCode to 1 for invalid config', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), 'invalid toml [[[')

    await validateCommand()

    expect(process.exitCode).toBe(1)
  })

  it('output contains "Config loaded" and discovery counts on success', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), '[skills]\ndir = ["skills/"]\n')
    const skillDir = path.join(tmpDir, 'skills', 'a-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: a-skill\ndescription: A skill\n---\n# A\n',
    )
    const evalDir = path.join(skillDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(
      path.join(evalDir, 'selection.yaml'),
      toYaml({ evals: [{ name: 'sel1', prompt: 'Pick', assert: ['a-skill'] }] }),
    )

    await validateCommand()

    const output = logSpy.mock.calls.map(c => c[0] as string).join('\n')
    expect(output).toContain('Config loaded')
    expect(output).toMatch(/1 skill discovered/)
    expect(output).toMatch(/1 selection eval validated/)
    expect(output).toMatch(/0 effectiveness evals validated/)
  })

  it('contains summary line "Validated X skills, Y selection evals, Z effectiveness evals" in stderr', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), '[skills]\ndir = ["skills/"]\n')
    const skillDir = path.join(tmpDir, 'skills', 'b-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: b-skill\ndescription: B skill\n---\n# B\n',
    )
    const evalDir = path.join(skillDir, 'evals')
    await mkdir(evalDir, { recursive: true })
    await writeFile(
      path.join(evalDir, 'selection.yaml'),
      toYaml({ evals: [{ name: 'sel1', prompt: 'Pick', assert: ['b-skill'] }] }),
    )

    await validateCommand()

    const output = stderrSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(output).toMatch(/Validated 1 skill.*1 selection eval.*0 effectiveness eval/)
  })
})
