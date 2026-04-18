import { describe, expect, it } from 'vitest'
import { globMatch } from '../../src/utils/glob-match.js'

describe('globMatch', () => {
  it('matches substring when no wildcards', () => {
    expect(globMatch('foo', 'foobar')).toBe(true)
    expect(globMatch('bar', 'foobar')).toBe(true)
    expect(globMatch('baz', 'foobar')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(globMatch('FOO', 'foobar')).toBe(true)
    expect(globMatch('should-*', 'Should-Select')).toBe(true)
  })

  it('matches * as any characters', () => {
    expect(globMatch('should-*', 'should-select')).toBe(true)
    expect(globMatch('should-*', 'should-not-select')).toBe(true)
    expect(globMatch('should-*', 'other')).toBe(false)
  })

  it('matches ? as single character', () => {
    expect(globMatch('v?', 'v1')).toBe(true)
    expect(globMatch('v?', 'v2')).toBe(true)
    expect(globMatch('v?', 'v10')).toBe(false)
  })

  it('combines * and ?', () => {
    expect(globMatch('v?-*', 'v1-concise')).toBe(true)
    expect(globMatch('v?-*', 'v2-verbose')).toBe(true)
    expect(globMatch('v?-*', 'base')).toBe(false)
  })

  it('anchors glob patterns to full string', () => {
    expect(globMatch('*select', 'should-select')).toBe(true)
    expect(globMatch('*select', 'should-select-foo')).toBe(false)
  })

  it('escapes regex special characters', () => {
    expect(globMatch('foo.bar', 'foo.bar')).toBe(true)
    expect(globMatch('foo.bar', 'fooxbar')).toBe(false)
    expect(globMatch('foo.*', 'foo.bar')).toBe(true)
  })
})
