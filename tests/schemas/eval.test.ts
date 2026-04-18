import { describe, expect, it } from 'vitest'
import {
  DecoySchema,
  SelectionEvalSchema,
  SelectionFileSchema,
  VariantSchema,
} from '../../src/schemas/eval.js'

describe('DecoySchema', () => {
  it('defaults enabled to true', () => {
    const result = DecoySchema.parse({ name: 'fake', value: 'A decoy' })
    expect(result.enabled).toBe(true)
  })
})

describe('VariantSchema', () => {
  it('parses valid variant with defaults', () => {
    const result = VariantSchema.parse({ name: 'v1', value: 'content' })
    expect(result.enabled).toBe(true)
  })

  it('rejects empty name', () => {
    expect(() => VariantSchema.parse({ name: '', value: 'content' })).toThrow()
  })

  it('rejects empty value', () => {
    expect(() => VariantSchema.parse({ name: 'v1', value: '' })).toThrow()
  })

  it('accepts decoys', () => {
    const result = VariantSchema.parse({
      name: 'v1',
      value: 'content',
      decoys: [{ name: 'fake', value: 'decoy value' }],
    })
    expect(result.decoys).toHaveLength(1)
  })
})

describe('SelectionEvalSchema', () => {
  const validEval = {
    name: 'test eval',
    prompt: 'Pick the right skill',
  }

  it('parses valid eval', () => {
    const result = SelectionEvalSchema.parse(validEval)
    expect(result.name).toBe('test eval')
  })

  it('defaults enabled to true', () => {
    const result = SelectionEvalSchema.parse(validEval)
    expect(result.enabled).toBe(true)
  })

  it('defaults variants to all', () => {
    const result = SelectionEvalSchema.parse(validEval)
    expect(result.variants).toBe('all')
  })

  it('accepts assert mode "none"', () => {
    const result = SelectionEvalSchema.parse({ ...validEval, assert: 'none' })
    expect(result.assert).toBe('none')
  })

  it('accepts assert mode "any"', () => {
    const result = SelectionEvalSchema.parse({ ...validEval, assert: 'any' })
    expect(result.assert).toBe('any')
  })

  it('accepts assert as string array', () => {
    const result = SelectionEvalSchema.parse({ ...validEval, assert: ['skill-a', 'skill-b'] })
    expect(result.assert).toEqual(['skill-a', 'skill-b'])
  })

  it('accepts decoys with value field', () => {
    const result = SelectionEvalSchema.parse({
      ...validEval,
      decoys: [{ name: 'fake', value: 'A decoy skill' }],
    })
    expect(result.decoys).toHaveLength(1)
  })

  it('accepts skills as "all"', () => {
    const result = SelectionEvalSchema.parse({ ...validEval, skills: 'all' })
    expect(result.skills).toBe('all')
  })

  it('accepts skills as string array', () => {
    const result = SelectionEvalSchema.parse({ ...validEval, skills: ['s1', 's2'] })
    expect(result.skills).toEqual(['s1', 's2'])
  })

  it('accepts run-mode', () => {
    const result = SelectionEvalSchema.parse({ ...validEval, 'run-mode': 'variants-only' })
    expect(result['run-mode']).toBe('variants-only')
  })

  it('rejects missing name', () => {
    expect(() => SelectionEvalSchema.parse({ prompt: 'Pick one' })).toThrow()
  })

  it('rejects missing prompt', () => {
    expect(() => SelectionEvalSchema.parse({ name: 'test' })).toThrow()
  })

  it('accepts inline variants', () => {
    const result = SelectionEvalSchema.parse({
      ...validEval,
      variants: [{ name: 'v1', value: 'content' }],
    })
    expect(result.variants).toHaveLength(1)
  })

  it('accepts variant name refs', () => {
    const result = SelectionEvalSchema.parse({
      ...validEval,
      variants: ['variant-a', 'variant-b'],
    })
    expect(result.variants).toEqual(['variant-a', 'variant-b'])
  })
})

describe('SelectionFileSchema', () => {
  const validFile = {
    evals: [{ name: 'test-eval', prompt: 'Pick the right skill' }],
  }

  it('parses valid file', () => {
    const result = SelectionFileSchema.parse(validFile)
    expect(result.evals).toHaveLength(1)
  })

  it('defaults timeout to 30', () => {
    const result = SelectionFileSchema.parse(validFile)
    expect(result.timeout).toBe(30)
  })

  it('defaults skills to all', () => {
    const result = SelectionFileSchema.parse(validFile)
    expect(result.skills).toBe('all')
  })

  it('defaults run-mode to all', () => {
    const result = SelectionFileSchema.parse(validFile)
    expect(result['run-mode']).toBe('all')
  })

  it('accepts top-level variants with decoys', () => {
    const result = SelectionFileSchema.parse({
      ...validFile,
      variants: [
        {
          name: 'v1',
          value: 'content',
          decoys: [{ name: 'fake', value: 'decoy' }],
        },
      ],
    })
    expect(result.variants).toHaveLength(1)
    expect(result.variants![0].decoys).toHaveLength(1)
  })

  it('requires evals array', () => {
    expect(() => SelectionFileSchema.parse({})).toThrow()
  })
})
