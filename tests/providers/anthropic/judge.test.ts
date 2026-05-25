import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate }
    },
  }
})

import { AnthropicJudge } from '../../../src/providers/anthropic/judge.js'
import type { JudgeInput } from '../../../src/providers/types.js'

const makeInput = (overrides?: Partial<JudgeInput>): JudgeInput => ({
  prompt: 'Write a hello world function',
  skillContent: '# Hello World Skill',
  criteria: [
    { name: 'correctness', threshold: 0.8 },
    { name: 'style', threshold: 0.7 },
  ],
  artifact: {
    finalMessage: 'Here is your function',
    toolCalls: [],
    fsDiff: [],
  },
  ...overrides,
})

describe('AnthropicJudge', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns JudgeResult with correct structure when all criteria pass', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'submit_evaluation',
          input: {
            criteria_scores: [
              { name: 'correctness', score: 0.9, reasoning: 'Good' },
              { name: 'style', score: 0.85, reasoning: 'Clean' },
            ],
          },
        },
      ],
    })

    const judge = new AnthropicJudge()
    const result = await judge.evaluate(makeInput())

    expect(result.overallPassed).toBe(true)
    expect(result.perCriterion).toHaveLength(2)
    expect(result.perCriterion[0]).toEqual({
      name: 'correctness',
      score: 0.9,
      passed: true,
      reasoning: 'Good',
    })
    expect(result.judgeModel).toBe('claude-sonnet-4-5')
  })

  it('returns overallPassed: false when one criterion below threshold', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'submit_evaluation',
          input: {
            criteria_scores: [
              { name: 'correctness', score: 0.5, reasoning: 'Incomplete' },
              { name: 'style', score: 0.9, reasoning: 'Nice' },
            ],
          },
        },
      ],
    })

    const judge = new AnthropicJudge()
    const result = await judge.evaluate(makeInput())

    expect(result.overallPassed).toBe(false)
    expect(result.perCriterion[0].passed).toBe(false)
    expect(result.perCriterion[1].passed).toBe(true)
  })

  it('throws when API returns no tool_use block', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'No tool call here' }],
    })

    const judge = new AnthropicJudge()
    await expect(judge.evaluate(makeInput())).rejects.toThrow(
      'Judge did not return a tool_use block',
    )
  })

  it('uses provided model override', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'submit_evaluation',
          input: {
            criteria_scores: [
              { name: 'correctness', score: 1, reasoning: 'Perfect' },
              { name: 'style', score: 1, reasoning: 'Perfect' },
            ],
          },
        },
      ],
    })

    const judge = new AnthropicJudge('claude-opus-4')
    const result = await judge.evaluate(makeInput())

    expect(result.judgeModel).toBe('claude-opus-4')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-opus-4' }))
  })

  it('uses default model when none provided', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'submit_evaluation',
          input: {
            criteria_scores: [
              { name: 'correctness', score: 0.9, reasoning: 'Good' },
              { name: 'style', score: 0.8, reasoning: 'Ok' },
            ],
          },
        },
      ],
    })

    const judge = new AnthropicJudge()
    await judge.evaluate(makeInput())

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-4-5' }))
  })
})
