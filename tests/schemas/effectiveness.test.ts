import { describe, expect, it } from 'vitest'
import { EffectivenessEvalSchema, EffectivenessFileSchema } from '../../src/schemas/eval.js'

describe('EffectivenessEvalSchema', () => {
  const validEval = {
    name: 'test-eval',
    prompt: 'Write a hello world function',
    criteria: [{ name: 'correctness', pass_threshold: 0.8 }],
  }

  it('parses valid eval with one criterion', () => {
    const result = EffectivenessEvalSchema.parse(validEval)
    expect(result.name).toBe('test-eval')
    expect(result.criteria).toHaveLength(1)
  })

  it('defaults enabled to true', () => {
    const result = EffectivenessEvalSchema.parse(validEval)
    expect(result.enabled).toBe(true)
  })

  it('defaults variants to all', () => {
    const result = EffectivenessEvalSchema.parse(validEval)
    expect(result.variants).toBe('all')
  })

  it('rejects eval with no criteria', () => {
    expect(() => EffectivenessEvalSchema.parse({ ...validEval, criteria: [] })).toThrow()
  })

  it('rejects criterion with pass_threshold > 1', () => {
    expect(() =>
      EffectivenessEvalSchema.parse({
        ...validEval,
        criteria: [{ name: 'correctness', pass_threshold: 1.5 }],
      }),
    ).toThrow()
  })

  it('rejects criterion with pass_threshold < 0', () => {
    expect(() =>
      EffectivenessEvalSchema.parse({
        ...validEval,
        criteria: [{ name: 'correctness', pass_threshold: -0.1 }],
      }),
    ).toThrow()
  })

  it('rejects criterion with empty name', () => {
    expect(() =>
      EffectivenessEvalSchema.parse({
        ...validEval,
        criteria: [{ name: '', pass_threshold: 0.8 }],
      }),
    ).toThrow()
  })

  it('accepts fixtures filter', () => {
    const result = EffectivenessEvalSchema.parse({
      ...validEval,
      fixtures: ['fixture-a', 'fixture-b'],
    })
    expect(result.fixtures).toEqual(['fixture-a', 'fixture-b'])
  })

  it('accepts matrix override', () => {
    const result = EffectivenessEvalSchema.parse({
      ...validEval,
      matrix: {
        evaluators: [{ provider: 'anthropic', model: 'claude-sonnet-4-5' }],
      },
    })
    expect(result.matrix?.evaluators).toHaveLength(1)
  })

  it('rejects invalid provider in matrix', () => {
    expect(() =>
      EffectivenessEvalSchema.parse({
        ...validEval,
        matrix: {
          evaluators: [{ provider: 'invalid-provider', model: 'some-model' }],
        },
      }),
    ).toThrow()
  })
})

describe('EffectivenessFileSchema', () => {
  const validFile = {
    evals: [
      {
        name: 'test-eval',
        prompt: 'Write a function',
        criteria: [{ name: 'correctness', pass_threshold: 0.7 }],
      },
    ],
  }

  it('parses valid minimal file', () => {
    const result = EffectivenessFileSchema.parse(validFile)
    expect(result.evals).toHaveLength(1)
  })

  it('defaults timeout to 120', () => {
    const result = EffectivenessFileSchema.parse(validFile)
    expect(result.timeout).toBe(120)
  })

  it('accepts full file with defaults and matrix', () => {
    const result = EffectivenessFileSchema.parse({
      ...validFile,
      defaults: {
        matrix: {
          evaluators: [{ provider: 'openai', model: 'gpt-4o' }],
          judges: [{ provider: 'anthropic', model: 'claude-sonnet-4-5' }],
        },
      },
      variants: [{ name: 'concise', value: 'Short skill content' }],
    })
    expect(result.defaults?.matrix?.evaluators).toHaveLength(1)
    expect(result.variants).toHaveLength(1)
  })

  it('requires evals array', () => {
    expect(() => EffectivenessFileSchema.parse({})).toThrow()
  })
})
