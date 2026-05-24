import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionResult, SelectionRunOptions } from '../../../src/providers/types.js'

const mockMessagesCreate = vi.fn()
let lastRequest:
  | {
      model: string
      max_tokens: number
      system: string
      messages: Array<{ role: string; content: string }>
      tools: Array<{ name: string; input_schema: unknown }>
      tool_choice: { type: string }
    }
  | undefined
let lastOptions:
  | {
      signal?: AbortSignal
      timeout?: number
    }
  | undefined

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: (
        request: {
          model: string
          max_tokens: number
          system: string
          messages: Array<{ role: string; content: string }>
          tools: Array<{ name: string; input_schema: unknown }>
          tool_choice: { type: string }
        },
        options?: { signal?: AbortSignal; timeout?: number },
      ) => {
        lastRequest = request
        lastOptions = options
        return mockMessagesCreate(request, options)
      },
    }
  },
}))

const skills = [
  { name: 'code-review', description: 'Review code changes' },
  { name: 'sql-queries', description: 'Write SQL queries' },
]

const defaultOptions: SelectionRunOptions = { prompt: 'Review this PR', skills, timeout: 10_000 }

describe('AnthropicEvaluator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastRequest = undefined
    lastOptions = undefined
  })

  async function createEvaluator(): Promise<{
    runSelection(opts: SelectionRunOptions): Promise<SelectionResult>
  }> {
    const { AnthropicEvaluator } = await import('../../../src/providers/anthropic/evaluator.js')
    return new AnthropicEvaluator()
  }

  it('returns loaded: true when the model emits a load_skill tool_use block', async () => {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Loading the code-review skill.' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'load_skill',
          input: { skill_name: 'code-review' },
        },
      ],
    })

    const evaluator = await createEvaluator()
    const result = await evaluator.runSelection(defaultOptions)

    expect(result).toEqual({
      loaded: true,
      skillName: 'code-review',
      raw: 'Loading the code-review skill.',
    })
  })

  it('returns loaded: false when the model returns text only', async () => {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'I can handle this directly.' }],
    })

    const evaluator = await createEvaluator()
    const result = await evaluator.runSelection(defaultOptions)

    expect(result).toEqual({
      loaded: false,
      skillName: null,
      raw: 'I can handle this directly.',
    })
  })

  it('concatenates multiple text blocks into raw', async () => {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: 'Part one.' },
        { type: 'text', text: ' Part two.' },
      ],
    })

    const evaluator = await createEvaluator()
    const result = await evaluator.runSelection(defaultOptions)

    expect(result.raw).toBe('Part one. Part two.')
  })

  it('returns loaded: false when tool_use input is malformed', async () => {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'load_skill', input: { skill_name: 42 } }],
    })

    const evaluator = await createEvaluator()
    const result = await evaluator.runSelection(defaultOptions)

    expect(result).toEqual({ loaded: false, skillName: null, raw: '' })
  })

  it('propagates SDK errors instead of swallowing them', async () => {
    mockMessagesCreate.mockRejectedValue(new Error('Timeout reached'))

    const evaluator = await createEvaluator()

    await expect(evaluator.runSelection(defaultOptions)).rejects.toThrow('Timeout reached')
  })

  it('throws immediately when signal is already aborted', async () => {
    const evaluator = await createEvaluator()

    await expect(
      evaluator.runSelection({ ...defaultOptions, signal: AbortSignal.abort() }),
    ).rejects.toThrow('Aborted')
  })

  it('emits request_start and response events through onEvent', async () => {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'done' }],
    })
    const onEvent = vi.fn()

    const evaluator = await createEvaluator()
    await evaluator.runSelection({ ...defaultOptions, onEvent })

    const eventTypes = onEvent.mock.calls.map(call => (call[0] as { type: string }).type)
    expect(eventTypes).toEqual(['request_start', 'response'])
  })

  it('uses claude-haiku-4-5 as the default model when none is specified', async () => {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '' }],
    })

    const evaluator = await createEvaluator()
    await evaluator.runSelection(defaultOptions)

    expect(lastRequest?.model).toBe('claude-haiku-4-5')
  })

  it('honors an explicit model override', async () => {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '' }],
    })

    const evaluator = await createEvaluator()
    await evaluator.runSelection({ ...defaultOptions, model: 'claude-sonnet-4-6' })

    expect(lastRequest?.model).toBe('claude-sonnet-4-6')
  })

  it('forwards the abort signal and timeout to the SDK call', async () => {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '' }],
    })
    const controller = new AbortController()

    const evaluator = await createEvaluator()
    await evaluator.runSelection({ ...defaultOptions, signal: controller.signal })

    expect(lastOptions?.signal).toBe(controller.signal)
    expect(lastOptions?.timeout).toBe(10_000)
  })

  it('registers a load_skill tool with skill names as the enum', async () => {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '' }],
    })

    const evaluator = await createEvaluator()
    await evaluator.runSelection(defaultOptions)

    const tool = lastRequest?.tools[0]
    expect(tool?.name).toBe('load_skill')
    const schema = tool?.input_schema as {
      properties: { skill_name: { enum: string[] } }
      required: string[]
    }
    expect(schema.properties.skill_name.enum).toEqual(['code-review', 'sql-queries'])
    expect(schema.required).toEqual(['skill_name'])
  })
})
