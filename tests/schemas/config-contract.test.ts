import { describe, expect, it } from 'vitest'
import { DojoConfigSchema } from '../../src/schemas/config.js'

describe('DojoConfigSchema contract — camelCase keys', () => {
  it('accepts perSkill (camelCase)', () => {
    const result = DojoConfigSchema.parse({ reporting: { perSkill: false } })
    expect(result.reporting.perSkill).toBe(false)
  })

  it('accepts warnFixtureThreshold (camelCase)', () => {
    const result = DojoConfigSchema.parse({ effectiveness: { warnFixtureThreshold: 8 } })
    expect(result.effectiveness.warnFixtureThreshold).toBe(8)
  })

  it('accepts confirmFixtureThreshold (camelCase)', () => {
    const result = DojoConfigSchema.parse({ effectiveness: { confirmFixtureThreshold: 20 } })
    expect(result.effectiveness.confirmFixtureThreshold).toBe(20)
  })

  it('rejects snake_case key warn_fixture_threshold', () => {
    const result = DojoConfigSchema.parse({
      effectiveness: { warn_fixture_threshold: 10 },
    })
    // Snake case key is ignored (stripped), default is used
    expect(result.effectiveness.warnFixtureThreshold).toBe(4)
  })

  it('rejects snake_case key confirm_fixture_threshold', () => {
    const result = DojoConfigSchema.parse({
      effectiveness: { confirm_fixture_threshold: 10 },
    })
    expect(result.effectiveness.confirmFixtureThreshold).toBe(12)
  })

  it('rejects kebab-case key per-skill', () => {
    const result = DojoConfigSchema.parse({
      reporting: { 'per-skill': false },
    })
    // Kebab case key is ignored, default is used
    expect(result.reporting.perSkill).toBe(true)
  })

  it('has correct default values', () => {
    const result = DojoConfigSchema.parse({})
    expect(result.reporting.perSkill).toBe(true)
    expect(result.reporting.consolidated).toBe(false)
    expect(result.effectiveness.warnFixtureThreshold).toBe(4)
    expect(result.effectiveness.confirmFixtureThreshold).toBe(12)
  })
})
