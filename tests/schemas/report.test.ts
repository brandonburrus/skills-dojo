import { describe, expect, it } from 'vitest'
import { RunReportSchema } from '../../src/schemas/report.js'

describe('RunReportSchema', () => {
  const validReport = {
    runId: 'abc-123',
    timestamp: '2026-04-17T12:00:00Z',
    skill: 'my-skill',
    totalEvals: 2,
    passed: 1,
    failed: 1,
    results: [
      {
        eval: 'test-1',
        passed: true,
        expected: 'my-skill',
        actual: { loaded: true, skillName: 'my-skill' },
        durationMs: 150,
      },
      {
        eval: 'test-2',
        passed: false,
        expected: 'other-skill',
        actual: { loaded: false, skillName: null },
        durationMs: 200,
        error: 'Skill not found',
      },
    ],
  }

  it('parses valid report', () => {
    const result = RunReportSchema.parse(validReport)
    expect(result.runId).toBe('abc-123')
    expect(result.results).toHaveLength(2)
  })

  it('accepts null skillName', () => {
    const result = RunReportSchema.parse(validReport)
    expect(result.results[1].actual.skillName).toBeNull()
  })

  it('rejects missing runId', () => {
    const { runId: _, ...noId } = validReport
    expect(() => RunReportSchema.parse(noId)).toThrow()
  })

  it('rejects invalid timestamp', () => {
    expect(() => RunReportSchema.parse({ ...validReport, timestamp: 'not-a-date' })).toThrow()
  })

  it('rejects missing results array', () => {
    const { results: _, ...noResults } = validReport
    expect(() => RunReportSchema.parse(noResults)).toThrow()
  })
})
