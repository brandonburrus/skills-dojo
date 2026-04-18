import { describe, expect, it } from 'vitest'
import { VariantConfigSchema, VariantSchema } from '../../src/schemas/variant.js'

describe('VariantSchema', () => {
  it('parses valid variant with all fields', () => {
    const result = VariantSchema.parse({
      name: 'concise',
      description: 'A shorter description',
      enabled: false,
    })
    expect(result.name).toBe('concise')
    expect(result.description).toBe('A shorter description')
    expect(result.enabled).toBe(false)
  })

  it('defaults enabled to true when omitted', () => {
    const result = VariantSchema.parse({
      name: 'concise',
      description: 'A shorter description',
    })
    expect(result.enabled).toBe(true)
  })

  it('rejects empty name', () => {
    expect(() => VariantSchema.parse({ name: '', description: 'A description' })).toThrow()
  })

  it('rejects empty description', () => {
    expect(() => VariantSchema.parse({ name: 'concise', description: '' })).toThrow()
  })
})

describe('VariantConfigSchema', () => {
  it('defaults to all', () => {
    expect(VariantConfigSchema.parse(undefined)).toBe('all')
  })

  it('accepts inline-only', () => {
    expect(VariantConfigSchema.parse('inline-only')).toBe('inline-only')
  })

  it('accepts disabled', () => {
    expect(VariantConfigSchema.parse('disabled')).toBe('disabled')
  })

  it('rejects invalid values', () => {
    expect(() => VariantConfigSchema.parse('bogus')).toThrow()
  })
})
