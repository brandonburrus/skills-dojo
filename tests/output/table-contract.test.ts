import { describe, expect, it } from 'vitest'
import { formatRunReport, formatEffectivenessReport } from '../../src/output/table.js'
import type { RunReport } from '../../src/types.js'
import type { EffectivenessEvalResult } from '../../src/runner/effectiveness.js'

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI stripping
const stripAnsi = (str: string): string => str.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')

describe('formatRunReport contract', () => {
  const makeReport = (overrides: Partial<RunReport> = {}): RunReport => ({
    runId: 'r-1',
    timestamp: '2026-05-25T00:00:00Z',
    skill: 'test-skill',
    totalEvals: 2,
    passed: 1,
    failed: 1,
    results: [
      {
        eval: 'eval-a',
        passed: true,
        expected: 'test-skill',
        actual: { loaded: true, skillName: 'test-skill' },
        durationMs: 100,
        evalSkillName: 'test-skill',
      },
      {
        eval: 'eval-b',
        passed: false,
        expected: 'test-skill',
        actual: { loaded: false, skillName: null },
        durationMs: 200,
        evalSkillName: 'test-skill',
      },
    ],
    ...overrides,
  })

  it('contains "Skill Selection: <name>" header', () => {
    const output = stripAnsi(formatRunReport(makeReport()))
    expect(output).toContain('Skill Selection: test-skill')
  })

  it('contains "X/Y passed" summary line', () => {
    const output = stripAnsi(formatRunReport(makeReport()))
    expect(output).toContain('1/2 passed')
  })

  it('shows PASS/FAIL in the last column of the table', () => {
    const output = stripAnsi(formatRunReport(makeReport()))
    const lines = output.split('\n').filter(l => l.includes('PASS') || l.includes('FAIL'))
    for (const line of lines) {
      const cells = line
        .split('│')
        .map(c => c.trim())
        .filter(Boolean)
      const lastCell = cells[cells.length - 1]
      expect(lastCell === 'PASS' || lastCell === 'FAIL').toBe(true)
    }
  })

  it('shows variant matrix when variants are present', () => {
    const report = makeReport({
      results: [
        {
          eval: 'pick',
          passed: true,
          expected: 'test-skill',
          actual: { loaded: true, skillName: 'test-skill' },
          durationMs: 100,
          evalSkillName: 'test-skill',
        },
        {
          eval: 'pick',
          passed: false,
          expected: 'test-skill',
          actual: { loaded: false, skillName: null },
          durationMs: 200,
          variant: 'concise',
          evalSkillName: 'test-skill',
        },
      ],
    })
    const output = stripAnsi(formatRunReport(report))
    expect(output).toContain('current')
    expect(output).toContain('concise')
  })

  it('shows flat table when no variants', () => {
    const output = stripAnsi(formatRunReport(makeReport()))
    expect(output).toContain('Eval')
    expect(output).toContain('Expected')
    expect(output).toContain('Result')
    expect(output).not.toContain('current')
  })
})

describe('formatEffectivenessReport contract', () => {
  const makeResults = (
    overrides: Partial<EffectivenessEvalResult>[] = [],
  ): EffectivenessEvalResult[] => [
    {
      eval: 'eff-1',
      fixture: 'fix-a',
      evaluator: 'anthropic/claude',
      judge: 'anthropic/claude',
      variant: 'current',
      skillName: 'my-skill',
      passed: true,
      criteria: [{ name: 'c1', score: 0.9, passed: true, reasoning: 'Good' }],
      durationMs: 1000,
      ...overrides[0],
    },
    {
      eval: 'eff-2',
      fixture: 'fix-b',
      evaluator: 'anthropic/claude',
      judge: 'anthropic/claude',
      variant: 'current',
      skillName: 'my-skill',
      passed: false,
      criteria: [{ name: 'c1', score: 0.3, passed: false, reasoning: 'Bad' }],
      durationMs: 2000,
      ...overrides[1],
    },
  ]

  it('contains "Skill Effectiveness: <name>" header', () => {
    const output = stripAnsi(formatEffectivenessReport('my-skill', makeResults()))
    expect(output).toContain('Skill Effectiveness: my-skill')
  })

  it('contains "X/Y criteria passed" summary', () => {
    const output = stripAnsi(formatEffectivenessReport('my-skill', makeResults()))
    expect(output).toContain('1/2 criteria passed')
  })

  it('shows ERROR for errored results', () => {
    const results: EffectivenessEvalResult[] = [
      {
        eval: 'eff-err',
        fixture: 'fix-a',
        evaluator: 'anthropic/claude',
        judge: 'anthropic/claude',
        variant: 'current',
        skillName: 'my-skill',
        passed: false,
        criteria: [],
        durationMs: 500,
        error: 'Timeout exceeded',
      },
    ]
    const output = stripAnsi(formatEffectivenessReport('my-skill', results))
    expect(output).toContain('ERROR')
  })

  it('lists unique errors with counts', () => {
    const results: EffectivenessEvalResult[] = [
      {
        eval: 'e1',
        fixture: 'f1',
        evaluator: 'a/b',
        judge: 'a/b',
        variant: 'current',
        skillName: 'my-skill',
        passed: false,
        criteria: [],
        durationMs: 100,
        error: 'Connection failed',
      },
      {
        eval: 'e2',
        fixture: 'f2',
        evaluator: 'a/b',
        judge: 'a/b',
        variant: 'current',
        skillName: 'my-skill',
        passed: false,
        criteria: [],
        durationMs: 100,
        error: 'Connection failed',
      },
    ]
    const output = stripAnsi(formatEffectivenessReport('my-skill', results))
    expect(output).toContain('(2x)')
    expect(output).toContain('Connection failed')
  })
})
