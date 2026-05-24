import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionResult, SelectionRunOptions } from '../../../src/providers/types.js'

const mockGenerateText = vi.fn()

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  tool: (def: unknown) => def,
}))

vi.mock('@ai-sdk/openai', () => ({
  openai: (modelId: string) => ({ provider: 'openai', modelId }),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: (modelId: string) => ({ provider: 'anthropic', modelId }),
}))

const skills = [
  { name: 'code-review', description: 'Review code changes' },
  { name: 'sql-queries', description: 'Write SQL queries' },
]

const defaultOptions: SelectionRunOptions = { prompt: 'Review this PR', skills, timeout: 10_000 }

describe('VercelEvaluator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function createEvaluator(): Promise<{
    runSelection(opts: SelectionRunOptions): Promise<SelectionResult>
  }> {
    const { VercelEvaluator } = await import('../../../src/providers/vercel/evaluator.js')
    return new VercelEvaluator()
  }

  it('returns loaded: true when the model calls load_skill', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Loading the code-review skill.',
      toolCalls: [{ toolName: 'load_skill', input: { skill_name: 'code-review' } }],
      finishReason: 'tool-calls',
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
    mockGenerateText.mockResolvedValue({
      text: 'I can handle this directly.',
      toolCalls: [],
      finishReason: 'stop',
    })

    const evaluator = await createEvaluator()
    const result = await evaluator.runSelection(defaultOptions)

    expect(result).toEqual({
      loaded: false,
      skillName: null,
      raw: 'I can handle this directly.',
    })
  })

  it('returns empty raw when text is undefined', async () => {
    mockGenerateText.mockResolvedValue({
      text: undefined,
      toolCalls: [],
      finishReason: 'stop',
    })

    const evaluator = await createEvaluator()
    const result = await evaluator.runSelection(defaultOptions)

    expect(result).toEqual({ loaded: false, skillName: null, raw: '' })
  })

  it('propagates SDK errors instead of swallowing them', async () => {
    mockGenerateText.mockRejectedValue(new Error('Timeout reached'))

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
    mockGenerateText.mockResolvedValue({
      text: 'done',
      toolCalls: [],
      finishReason: 'stop',
    })
    const onEvent = vi.fn()

    const evaluator = await createEvaluator()
    await evaluator.runSelection({ ...defaultOptions, onEvent })

    const eventTypes = onEvent.mock.calls.map(call => (call[0] as { type: string }).type)
    expect(eventTypes).toEqual(['request_start', 'response'])
  })

  it('uses openai/gpt-4o-mini as the default model when none is specified', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      toolCalls: [],
      finishReason: 'stop',
    })

    const evaluator = await createEvaluator()
    await evaluator.runSelection(defaultOptions)

    const call = mockGenerateText.mock.calls[0][0]
    expect(call.model).toEqual({ provider: 'openai', modelId: 'gpt-4o-mini' })
  })

  it('honors an explicit model override with openai provider', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      toolCalls: [],
      finishReason: 'stop',
    })

    const evaluator = await createEvaluator()
    await evaluator.runSelection({ ...defaultOptions, model: 'openai/gpt-4o' })

    const call = mockGenerateText.mock.calls[0][0]
    expect(call.model).toEqual({ provider: 'openai', modelId: 'gpt-4o' })
  })

  it('routes to anthropic provider when model string starts with anthropic/', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      toolCalls: [],
      finishReason: 'stop',
    })

    const evaluator = await createEvaluator()
    await evaluator.runSelection({ ...defaultOptions, model: 'anthropic/claude-haiku-4-5' })

    const call = mockGenerateText.mock.calls[0][0]
    expect(call.model).toEqual({ provider: 'anthropic', modelId: 'claude-haiku-4-5' })
  })

  it('throws DojoError for model string without provider prefix', async () => {
    const { VercelEvaluator } = await import('../../../src/providers/vercel/evaluator.js')
    const evaluator = new VercelEvaluator()

    await expect(
      evaluator.runSelection({ ...defaultOptions, model: 'gpt-4o-mini' }),
    ).rejects.toThrow(/must be in the form/)
  })

  it('throws DojoError for unsupported underlying provider', async () => {
    const { VercelEvaluator } = await import('../../../src/providers/vercel/evaluator.js')
    const evaluator = new VercelEvaluator()

    await expect(
      evaluator.runSelection({ ...defaultOptions, model: 'mistral/large' }),
    ).rejects.toThrow(/Unsupported Vercel AI SDK underlying provider/)
  })

  it('passes an abort signal to generateText', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      toolCalls: [],
      finishReason: 'stop',
    })
    const controller = new AbortController()

    const evaluator = await createEvaluator()
    await evaluator.runSelection({ ...defaultOptions, signal: controller.signal })

    const call = mockGenerateText.mock.calls[0][0]
    expect(call.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('registers a load_skill tool with the correct skill names', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      toolCalls: [],
      finishReason: 'stop',
    })

    const evaluator = await createEvaluator()
    await evaluator.runSelection(defaultOptions)

    const call = mockGenerateText.mock.calls[0][0]
    const loadSkill = call.tools.load_skill
    expect(loadSkill).toBeDefined()
    expect(loadSkill.description).toContain('code-review')
    expect(loadSkill.description).toContain('sql-queries')
  })
})
