import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigValidationError } from '../../src/errors.js'
import { DEFAULT_CONFIG } from '../../src/schemas/config.js'
import { loadConfig } from '../../src/loaders/config.js'

describe('loadConfig', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dojo-config-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns DEFAULT_CONFIG when no dojo.toml exists', async () => {
    const result = await loadConfig(tmpDir)
    expect(result.config).toEqual(DEFAULT_CONFIG)
    expect(result.configDir).toBe(tmpDir)
  })

  it('parses partial config and merges with defaults', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), '[model]\nprovider = "openai"\n')
    const result = await loadConfig(tmpDir)
    expect(result.config.model.provider).toBe('openai')
    expect(result.config.model.judge).toBeUndefined()
    expect(result.configDir).toBe(tmpDir)
  })

  it('parses fully specified config', async () => {
    const toml = [
      '[skills]',
      'dir = ["/custom/"]',
      '[model]',
      'provider = "openai"',
      'evaluator = "gpt-5"',
      'judge = "claude-3"',
      '[reporting]',
      'perSkill = false',
      'consolidated = true',
    ].join('\n')
    await writeFile(path.join(tmpDir, 'dojo.toml'), toml)
    const result = await loadConfig(tmpDir)
    expect(result.config.skills.dir).toEqual(['/custom/'])
    expect(result.config.model.provider).toBe('openai')
    expect(result.config.model.evaluator).toBe('gpt-5')
    expect(result.config.model.judge).toBe('claude-3')
    expect(result.config.reporting.perSkill).toBe(false)
    expect(result.config.reporting.consolidated).toBe(true)
  })

  it('throws ConfigValidationError on invalid TOML syntax', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), '[invalid toml =')
    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigValidationError)
  })

  it('throws ConfigValidationError with issues on invalid config values', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), '[skills]\ndir = 123\n')
    try {
      await loadConfig(tmpDir)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError)
      const error = err as ConfigValidationError
      expect(error.issues.length).toBeGreaterThan(0)
      expect(error.issues[0]!.message).toBeDefined()
    }
  })

  it('applies CLI overrides to default config', async () => {
    const result = await loadConfig(tmpDir, {
      modelProvider: 'openai',
      evaluatorModel: 'gpt-5',
      skillsDir: ['/custom/'],
    })
    expect(result.config.model.provider).toBe('openai')
    expect(result.config.model.evaluator).toBe('gpt-5')
    expect(result.config.skills.dir).toEqual(['/custom/'])
  })

  it('CLI overrides take precedence over file config', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), '[model]\nprovider = "openai"\n')
    const result = await loadConfig(tmpDir, { modelProvider: 'anthropic' })
    expect(result.config.model.provider).toBe('anthropic')
  })

  it('leaves config unchanged when overrides are empty', async () => {
    await writeFile(path.join(tmpDir, 'dojo.toml'), '[model]\nprovider = "openai"\n')
    const result = await loadConfig(tmpDir, {})
    expect(result.config.model.provider).toBe('openai')
  })
})
