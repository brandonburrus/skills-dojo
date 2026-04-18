import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/index.js'

describe('index', () => {
  it('exports VERSION', () => {
    expect(VERSION).toBe('1.0.0')
  })
})
