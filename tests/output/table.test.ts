import { describe, expect, it } from 'vitest'
import { formatRunReport } from '../../src/output/table.js'
import type { RunReport } from '../../src/types.js'

const makeReport = (overrides: Partial<RunReport> = {}): RunReport => ({
  runId: 'abc-123',
  timestamp: '2026-04-17T12:00:00Z',
  skill: 'my-skill',
  totalEvals: 2,
  passed: 1,
  failed: 1,
  results: [
    {
      eval: 'test-pass',
      passed: true,
      expected: 'my-skill',
      actual: { loaded: true, skillName: 'my-skill' },
      durationMs: 1200,
    },
    {
      eval: 'test-fail',
      passed: false,
      expected: 'my-skill',
      actual: { loaded: false, skillName: null },
      durationMs: 500,
      error: 'skill not loaded',
    },
  ],
  ...overrides,
})

describe('formatRunReport', () => {
  it('includes PASS and FAIL for mixed results', () => {
    const output = formatRunReport(makeReport())

    expect(output).toContain('PASS')
    expect(output).toContain('FAIL')
    expect(output).toContain('Run: abc-123')
    expect(output).toContain('1.2s')
    expect(output).toContain('0.5s')
  })

  it('shows correct summary for all passing', () => {
    const report = makeReport({
      totalEvals: 3,
      passed: 3,
      failed: 0,
      results: [
        {
          eval: 'a',
          passed: true,
          expected: 'my-skill',
          actual: { loaded: true, skillName: 'my-skill' },
          durationMs: 100,
        },
        {
          eval: 'b',
          passed: true,
          expected: 'my-skill',
          actual: { loaded: true, skillName: 'my-skill' },
          durationMs: 200,
        },
        {
          eval: 'c',
          passed: true,
          expected: 'my-skill',
          actual: { loaded: true, skillName: 'my-skill' },
          durationMs: 300,
        },
      ],
    })

    const output = formatRunReport(report)

    expect(output).toContain('3/3 passed')
  })

  it('formats without error when results are empty', () => {
    const report = makeReport({
      totalEvals: 0,
      passed: 0,
      failed: 0,
      results: [],
    })

    const output = formatRunReport(report)

    expect(output).toContain('0/0 passed')
    expect(output).toContain('Run: abc-123')
  })
})
