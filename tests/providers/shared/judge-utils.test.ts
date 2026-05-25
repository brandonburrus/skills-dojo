import { describe, expect, it } from 'vitest'
import {
  buildJudgeUserMessage,
  validateAndBuildResult,
  MAX_TOOL_OUTPUT_LENGTH,
} from '../../../src/providers/shared/judge-utils.js'
import type { JudgeInput } from '../../../src/providers/types.js'

function makeInput(overrides: Partial<JudgeInput> = {}): JudgeInput {
  return {
    prompt: 'Write a hello world script',
    skillContent: '# Skill\nDo the thing.',
    criteria: [
      { name: 'correctness', description: 'Output is correct', threshold: 0.8 },
      { name: 'style', description: 'Code is clean', threshold: 0.6 },
    ],
    artifact: {
      finalMessage: 'Done! Here is your script.',
      toolCalls: [],
      fsDiff: [],
    },
    ...overrides,
  }
}

describe('buildJudgeUserMessage', () => {
  it('contains task prompt section', () => {
    const msg = buildJudgeUserMessage(makeInput())
    expect(msg).toContain('## Task Prompt')
    expect(msg).toContain('Write a hello world script')
  })

  it('contains skill content section', () => {
    const msg = buildJudgeUserMessage(makeInput())
    expect(msg).toContain('## Skill Instructions')
    expect(msg).toContain('# Skill\nDo the thing.')
  })

  it('contains artifact final message', () => {
    const msg = buildJudgeUserMessage(makeInput())
    expect(msg).toContain('## Agent Artifact')
    expect(msg).toContain('Done! Here is your script.')
  })

  it('includes tool calls when present', () => {
    const input = makeInput({
      artifact: {
        finalMessage: 'Done',
        toolCalls: [{ tool: 'bash', input: { cmd: 'echo hi' }, output: 'hi' }],
        fsDiff: [],
      },
    })
    const msg = buildJudgeUserMessage(input)
    expect(msg).toContain('### Tool Calls')
    expect(msg).toContain('**bash**')
    expect(msg).toContain('echo hi')
  })

  it('truncates long tool outputs at MAX_TOOL_OUTPUT_LENGTH', () => {
    const longOutput = 'x'.repeat(MAX_TOOL_OUTPUT_LENGTH + 1000)
    const input = makeInput({
      artifact: {
        finalMessage: 'Done',
        toolCalls: [{ tool: 'bash', input: {}, output: longOutput }],
        fsDiff: [],
      },
    })
    const msg = buildJudgeUserMessage(input)
    expect(msg).toContain('[truncated]')
    expect(msg.length).toBeLessThan(longOutput.length + 5000)
  })

  it('includes filesystem changes when present', () => {
    const input = makeInput({
      artifact: {
        finalMessage: 'Done',
        toolCalls: [],
        fsDiff: [
          { path: 'src/index.ts', type: 'added', content: 'console.log("hi")' },
          { path: 'old.ts', type: 'deleted' },
        ],
      },
    })
    const msg = buildJudgeUserMessage(input)
    expect(msg).toContain('### Filesystem Changes')
    expect(msg).toContain('**added**: src/index.ts')
    expect(msg).toContain('**deleted**: old.ts')
    expect(msg).toContain('console.log("hi")')
  })

  it('includes golden reference notes when present', () => {
    const input = makeInput({
      golden: { notes: 'The output should print hello world' },
    })
    const msg = buildJudgeUserMessage(input)
    expect(msg).toContain('## Golden Reference')
    expect(msg).toContain('### Notes')
    expect(msg).toContain('The output should print hello world')
  })

  it('includes golden reference files when present', () => {
    const input = makeInput({
      golden: {
        notes: 'Reference',
        files: [{ path: 'expected.ts', content: 'export const x = 1' }],
      },
    })
    const msg = buildJudgeUserMessage(input)
    expect(msg).toContain('### Expected Files')
    expect(msg).toContain('**expected.ts**')
    expect(msg).toContain('export const x = 1')
  })

  it('includes criteria list with names, thresholds, and descriptions', () => {
    const msg = buildJudgeUserMessage(makeInput())
    expect(msg).toContain('## Criteria to Evaluate')
    expect(msg).toContain('**correctness** (threshold: 0.8): Output is correct')
    expect(msg).toContain('**style** (threshold: 0.6): Code is clean')
  })
})

describe('validateAndBuildResult', () => {
  const input = makeInput()

  it('returns correct JudgeResult when all criteria pass threshold', () => {
    const parsed = {
      criteria_scores: [
        { name: 'correctness', score: 0.9, reasoning: 'Good' },
        { name: 'style', score: 0.7, reasoning: 'Clean' },
      ],
    }
    const result = validateAndBuildResult(parsed, input, 'test-model')
    expect(result.overallPassed).toBe(true)
    expect(result.judgeModel).toBe('test-model')
    expect(result.perCriterion).toHaveLength(2)
    expect(result.perCriterion[0].passed).toBe(true)
    expect(result.perCriterion[1].passed).toBe(true)
  })

  it('returns overallPassed: false when one criterion below threshold', () => {
    const parsed = {
      criteria_scores: [
        { name: 'correctness', score: 0.5, reasoning: 'Below threshold' },
        { name: 'style', score: 0.7, reasoning: 'Clean' },
      ],
    }
    const result = validateAndBuildResult(parsed, input, 'test-model')
    expect(result.overallPassed).toBe(false)
    expect(result.perCriterion[0].passed).toBe(false)
    expect(result.perCriterion[1].passed).toBe(true)
  })

  it('throws on duplicate criteria returned', () => {
    const parsed = {
      criteria_scores: [
        { name: 'correctness', score: 0.9, reasoning: 'Good' },
        { name: 'correctness', score: 0.8, reasoning: 'Also good' },
      ],
    }
    expect(() => validateAndBuildResult(parsed, input, 'test-model')).toThrow(/duplicate criteria/i)
  })

  it('throws on missing criteria', () => {
    const parsed = {
      criteria_scores: [{ name: 'correctness', score: 0.9, reasoning: 'Good' }],
    }
    expect(() => validateAndBuildResult(parsed, input, 'test-model')).toThrow(/Missing.*style/i)
  })

  it('throws on unexpected criteria', () => {
    const parsed = {
      criteria_scores: [
        { name: 'correctness', score: 0.9, reasoning: 'Good' },
        { name: 'style', score: 0.7, reasoning: 'Clean' },
        { name: 'bonus', score: 1.0, reasoning: 'Extra' },
      ],
    }
    expect(() => validateAndBuildResult(parsed, input, 'test-model')).toThrow(
      /unexpected criteria/i,
    )
  })
})
