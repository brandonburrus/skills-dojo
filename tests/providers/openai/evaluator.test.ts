import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionResult, SelectionRunOptions } from '../../../src/providers/types.js'

const mockCreate = vi.fn()
let lastCreateRequest:
  | {
      model: string
      tools?: Array<{ function: { name: string; parameters: unknown } }>
      messages: Array<{ role: string; content: string }>
      tool_choice: string
    }
  | undefined
let lastCreateOptions:
  | {
      signal?: AbortSignal
      timeout?: number
    }
  | undefined

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: (
          request: {
            model: string
            tools?: Array<{ function: { name: string; parameters: unknown } }>
            messages: Array<{ role: string; content: string }>
            tool_choice: string
          },
          options?: { signal?: AbortSignal; timeout?: number },
        ) => {
          lastCreateRequest = request
          lastCreateOptions = options
          return mockCreate(request, options)
        },
      },
    }
  },
}))

const skills = [
  { name: 'code-review', description: 'Review code changes' },
  { name: 'sql-queries', description: 'Write SQL queries' },
]

const defaultOptions: SelectionRunOptions = { prompt: 'Review this PR', skills, timeout: 10_000 }

describe('OpenAIEvaluator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastCreateRequest = undefined
    lastCreateOptions = undefined
  })

  async function createEvaluator(): Promise<{
    runSelection(opts: SelectionRunOptions): Promise<SelectionResult>
  }> {
    const { OpenAIEvaluator } = await import('../../../src/providers/openai/evaluator.js')
    return new OpenAIEvaluator()
  }

  it('returns loaded: true when the model calls load_skill', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: 'Loading the code-review skill.',
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: 'load_skill',
                  arguments: JSON.stringify({ skill_name: 'code-review' }),
                },
              },
            ],
          },
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

  it('returns loaded: false when the model responds without a tool call', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: 'I can handle this directly.', tool_calls: [] },
        },
      ],
    })

    const evaluator = await createEvaluator()
    const result = await evaluator.runSelection(defaultOptions)

    expect(result).toEqual({
      loaded: false,
      skillName: null,
      raw: 'I can handle this directly.',
    })
  })

  it('returns empty raw when the message has no content', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: null } }],
    })

    const evaluator = await createEvaluator()
    const result = await evaluator.runSelection(defaultOptions)

    expect(result).toEqual({ loaded: false, skillName: null, raw: '' })
  })

  it('treats malformed tool arguments as no-skill (does not throw)', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: '',
            tool_calls: [
              {
                type: 'function',
                function: { name: 'load_skill', arguments: '{ this is not json' },
              },
            ],
          },
        },
      ],
    })

    const evaluator = await createEvaluator()
    const result = await evaluator.runSelection(defaultOptions)

    expect(result).toEqual({ loaded: false, skillName: null, raw: '' })
  })

  it('propagates SDK errors instead of swallowing them', async () => {
    mockCreate.mockRejectedValue(new Error('Timeout reached'))

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
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: 'done', tool_calls: [] } }],
    })
    const onEvent = vi.fn()

    const evaluator = await createEvaluator()
    await evaluator.runSelection({ ...defaultOptions, onEvent })

    const eventTypes = onEvent.mock.calls.map(call => (call[0] as { type: string }).type)
    expect(eventTypes).toEqual(['request_start', 'response'])
  })

  it('uses gpt-4o-mini as the default model when none is specified', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '', tool_calls: [] } }],
    })

    const evaluator = await createEvaluator()
    await evaluator.runSelection(defaultOptions)

    expect(lastCreateRequest?.model).toBe('gpt-4o-mini')
  })

  it('honors an explicit model override', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '', tool_calls: [] } }],
    })

    const evaluator = await createEvaluator()
    await evaluator.runSelection({ ...defaultOptions, model: 'gpt-4o' })

    expect(lastCreateRequest?.model).toBe('gpt-4o')
  })

  it('forwards the abort signal and timeout to the SDK call', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '', tool_calls: [] } }],
    })
    const controller = new AbortController()

    const evaluator = await createEvaluator()
    await evaluator.runSelection({ ...defaultOptions, signal: controller.signal })

    expect(lastCreateOptions?.signal).toBe(controller.signal)
    expect(lastCreateOptions?.timeout).toBe(10_000)
  })

  it('registers a load_skill tool with skill names as the enum', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '', tool_calls: [] } }],
    })

    const evaluator = await createEvaluator()
    await evaluator.runSelection(defaultOptions)

    const tool = lastCreateRequest?.tools?.[0]
    expect(tool?.function.name).toBe('load_skill')
    const params = tool?.function.parameters as {
      properties: { skill_name: { enum: string[] } }
      required: string[]
    }
    expect(params.properties.skill_name.enum).toEqual(['code-review', 'sql-queries'])
    expect(params.required).toEqual(['skill_name'])
  })
})
