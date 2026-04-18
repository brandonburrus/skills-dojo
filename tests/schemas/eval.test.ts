import { describe, expect, it } from 'vitest'
import { EvalSchema, SelectionEvalSchema } from '../../src/schemas/eval.js'

describe('SelectionEvalSchema', () => {
  const validEval = {
    name: 'test eval',
    type: 'selection' as const,
    prompt: 'Pick the right skill',
    selection: {
      expect: 'my-skill',
      available: ['my-skill', 'other-skill'],
    },
  }

  it('parses valid eval', () => {
    const result = SelectionEvalSchema.parse(validEval)
    expect(result.name).toBe('test eval')
    expect(result.timeout_seconds).toBe(30)
  })

  it('accepts custom timeout', () => {
    const result = SelectionEvalSchema.parse({ ...validEval, timeout_seconds: 60 })
    expect(result.timeout_seconds).toBe(60)
  })

  it('accepts "all" for available', () => {
    const result = SelectionEvalSchema.parse({
      ...validEval,
      selection: { expect: 'my-skill', available: 'all' },
    })
    expect(result.selection.available).toBe('all')
  })

  it('accepts "none" as expect value', () => {
    const result = SelectionEvalSchema.parse({
      ...validEval,
      selection: { expect: 'none', available: 'all' },
    })
    expect(result.selection.expect).toBe('none')
  })

  it('accepts "any" as expect value', () => {
    const result = SelectionEvalSchema.parse({
      ...validEval,
      selection: { expect: 'any', available: 'all' },
    })
    expect(result.selection.expect).toBe('any')
  })

  it('accepts decoys', () => {
    const result = SelectionEvalSchema.parse({
      ...validEval,
      selection: {
        ...validEval.selection,
        decoys: [{ name: 'fake', description: 'A decoy skill' }],
      },
    })
    expect(result.selection.decoys).toHaveLength(1)
  })

  it('rejects missing prompt', () => {
    const { prompt: _, ...noPrompt } = validEval
    expect(() => SelectionEvalSchema.parse(noPrompt)).toThrow()
  })

  it('rejects missing selection', () => {
    const { selection: _, ...noSelection } = validEval
    expect(() => SelectionEvalSchema.parse(noSelection)).toThrow()
  })
})

describe('EvalSchema', () => {
  it('parses selection type via discriminated union', () => {
    const result = EvalSchema.parse({
      name: 'test',
      type: 'selection',
      prompt: 'Pick one',
      selection: { expect: 'my-skill', available: 'all' },
    })
    expect(result.type).toBe('selection')
  })

  it('rejects unknown type', () => {
    expect(() =>
      EvalSchema.parse({
        name: 'test',
        type: 'unknown',
        prompt: 'Pick one',
      }),
    ).toThrow()
  })
})
