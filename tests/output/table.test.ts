import { describe, expect, it } from 'vitest'
import { formatRunReport } from '../../src/output/table.js'
import type { RunReport } from '../../src/types.js'

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI stripping
const stripAnsi = (str: string): string => str.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')

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
      evalSkillName: 'my-skill',
    },
    {
      eval: 'test-fail',
      passed: false,
      expected: 'my-skill',
      actual: { loaded: false, skillName: null },
      durationMs: 500,
      error: 'skill not loaded',
      evalSkillName: 'my-skill',
    },
  ],
  ...overrides,
})

describe('formatRunReport', () => {
  it('includes PASS and FAIL for mixed results', () => {
    const output = stripAnsi(formatRunReport(makeReport()))

    expect(output).toContain('PASS')
    expect(output).toContain('FAIL')
    expect(output).toContain('Skill: my-skill')
  })

  it('shows flat table with eval names when no variants', () => {
    const output = formatRunReport(makeReport())

    expect(output).toContain('test-pass')
    expect(output).toContain('test-fail')
    expect(output).toContain('Eval')
  })

  it('shows variant matrix when variants present', () => {
    const report = makeReport({
      results: [
        {
          eval: 'pick-skill',
          passed: true,
          expected: 'my-skill',
          actual: { loaded: true, skillName: 'my-skill' },
          durationMs: 100,
          evalSkillName: 'my-skill',
        },
        {
          eval: 'pick-skill',
          passed: false,
          expected: 'my-skill',
          actual: { loaded: false, skillName: null },
          durationMs: 200,
          variant: 'concise',
          evalSkillName: 'my-skill',
        },
      ],
    })

    const output = formatRunReport(report)

    expect(output).toContain('current')
    expect(output).toContain('concise')
    expect(output).toContain('pick-skill')
    expect(output).toContain('PASS')
    expect(output).toContain('FAIL')
  })

  it('formats without error when results are empty', () => {
    const report = makeReport({
      totalEvals: 0,
      passed: 0,
      failed: 0,
      results: [],
    })

    const output = stripAnsi(formatRunReport(report))

    expect(output).toContain('Skill: my-skill')
  })
})
