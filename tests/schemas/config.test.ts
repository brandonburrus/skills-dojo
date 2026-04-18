import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, DojoConfigSchema } from '../../src/schemas/config.js'

describe('DojoConfigSchema', () => {
  it('parses empty object with defaults', () => {
    const result = DojoConfigSchema.parse({})
    expect(result.skills.dir).toEqual([
      'skills',
      '.agents/skills',
      '.github/skills',
      '.claude/skills',
      '.codex/skills',
      '.gemini/skills',
      '.openclaw/skills',
      '.opencode/skills',
    ])
    expect(result.model.provider).toBe('copilot')
    expect(result.model.evaluator).toBeUndefined()
    expect(result.model.judge).toBeUndefined()
  })

  it('accepts partial config and fills defaults', () => {
    const result = DojoConfigSchema.parse({
      model: { judge: 'gpt-4o' },
    })
    expect(result.model.judge).toBe('gpt-4o')
    expect(result.model.provider).toBe('copilot')
    expect(result.model.evaluator).toBeUndefined()
  })

  it('accepts fully specified config', () => {
    const result = DojoConfigSchema.parse({
      skills: { dir: ['/custom/'] },
      model: { provider: 'openai', evaluator: 'gpt-5', judge: 'claude-3' },
      reporting: { 'per-skill': false, consolidated: true },
    })
    expect(result.skills.dir).toEqual(['/custom/'])
    expect(result.model.provider).toBe('openai')
    expect(result.reporting['per-skill']).toBe(false)
    expect(result.reporting.consolidated).toBe(true)
  })

  it('accepts string for skills.dir', () => {
    const result = DojoConfigSchema.parse({ skills: { dir: 'my-skills/' } })
    expect(result.skills.dir).toBe('my-skills/')
  })

  it('exports DEFAULT_CONFIG', () => {
    expect(DEFAULT_CONFIG.model.provider).toBe('copilot')
    expect(DEFAULT_CONFIG.model.judge).toBeUndefined()
  })

  it('rejects invalid types', () => {
    expect(() => DojoConfigSchema.parse({ skills: { dir: 123 } })).toThrow()
  })
})
