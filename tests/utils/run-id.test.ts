import { describe, expect, it } from 'vitest'
import { generateRunId, WORDLIST } from '../../src/utils/run-id.js'

describe('generateRunId', () => {
  it('returns a three-word hyphenated string', () => {
    const id = generateRunId()
    expect(id).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/)
  })

  it('uses words from the wordlist', () => {
    const id = generateRunId()
    const words = id.split('-')
    for (const word of words) {
      expect(WORDLIST).toContain(word)
    }
  })

  it('produces different IDs across multiple calls', () => {
    const ids = Array.from({ length: 10 }, () => generateRunId())
    const unique = new Set(ids)
    expect(unique.size).toBeGreaterThan(1)
  })
})
