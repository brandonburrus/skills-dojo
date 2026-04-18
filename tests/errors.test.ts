import { describe, expect, it } from 'vitest'
import {
  ConfigValidationError,
  DojoError,
  EvalValidationError,
  SkillValidationError,
} from '../src/errors.js'

describe('DojoError', () => {
  it('sets name and message', () => {
    const err = new DojoError('something broke')
    expect(err.name).toBe('DojoError')
    expect(err.message).toBe('something broke')
    expect(err).toBeInstanceOf(Error)
  })

  it('supports cause chaining', () => {
    const cause = new Error('root cause')
    const err = new DojoError('wrapped', { cause })
    expect(err.cause).toBe(cause)
  })
})

describe('ConfigValidationError', () => {
  const issues = [{ path: 'skills', message: 'required' }] as const

  it('is an instance of DojoError and Error', () => {
    const err = new ConfigValidationError('invalid config', issues)
    expect(err).toBeInstanceOf(DojoError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ConfigValidationError')
  })

  it('stores issues', () => {
    const err = new ConfigValidationError('invalid config', issues)
    expect(err.issues).toEqual([{ path: 'skills', message: 'required' }])
  })
})

describe('SkillValidationError', () => {
  it('stores skillPath and chains through DojoError', () => {
    const cause = new Error('parse failed')
    const err = new SkillValidationError('bad skill', '/skills/foo', { cause })
    expect(err).toBeInstanceOf(DojoError)
    expect(err.name).toBe('SkillValidationError')
    expect(err.skillPath).toBe('/skills/foo')
    expect(err.cause).toBe(cause)
  })
})

describe('EvalValidationError', () => {
  it('stores evalPath and chains through DojoError', () => {
    const err = new EvalValidationError('bad eval', '/evals/bar.yaml')
    expect(err).toBeInstanceOf(DojoError)
    expect(err.name).toBe('EvalValidationError')
    expect(err.evalPath).toBe('/evals/bar.yaml')
  })
})
