import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionResult, SelectionRunOptions } from '../../../src/providers/types.js'

const mockSendAndWait = vi.fn()
const mockDisconnect = vi.fn()
const mockStop = vi.fn()
const mockOn = vi.fn()
const mockAbort = vi.fn()
let capturedTools: Array<{ name: string; handler: (args: Record<string, unknown>) => unknown }>

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: class MockCopilotClient {
    async createSession(config: { tools?: typeof capturedTools }) {
      capturedTools = config.tools ?? []
      return {
        sendAndWait: mockSendAndWait,
        disconnect: mockDisconnect,
        on: mockOn,
        abort: mockAbort,
      }
    }
    async stop() {
      return mockStop()
    }
  },
  approveAll: vi.fn(),
}))

const skills = [
  { name: 'code-review', description: 'Review code changes' },
  { name: 'sql-queries', description: 'Write SQL queries' },
]

const defaultOptions: SelectionRunOptions = { prompt: 'Review this PR', skills, timeout: 10_000 }

describe('CopilotEvaluator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedTools = []
  })

  async function createEvaluator(): Promise<{
    runSelection(opts: SelectionRunOptions): Promise<SelectionResult>
  }> {
    const { CopilotEvaluator } = await import('../../../src/providers/copilot/evaluator.js')
    return new CopilotEvaluator()
  }

  it('returns loaded: true when agent calls load_skill', async () => {
    mockSendAndWait.mockImplementation(async () => {
      const tool = capturedTools.find(t => t.name === 'load_skill')
      tool?.handler({ skill_name: 'code-review' })
      return { data: { content: 'I loaded the code-review skill.' } }
    })

    const evaluator = await createEvaluator()
    const result = await evaluator.runSelection(defaultOptions)

    expect(result).toEqual({
      loaded: true,
      skillName: 'code-review',
      raw: 'I loaded the code-review skill.',
    })
  })

  it('returns loaded: false when agent responds without tool call', async () => {
    mockSendAndWait.mockResolvedValue({
      data: { content: 'I can handle this directly.' },
    })

    const evaluator = await createEvaluator()
    const result = await evaluator.runSelection(defaultOptions)

    expect(result).toEqual({
      loaded: false,
      skillName: null,
      raw: 'I can handle this directly.',
    })
  })

  it('throws on timeout/error instead of swallowing', async () => {
    mockSendAndWait.mockRejectedValue(new Error('Timeout reached'))

    const evaluator = await createEvaluator()

    await expect(evaluator.runSelection(defaultOptions)).rejects.toThrow('Timeout reached')
  })

  it('returns empty raw when sendAndWait returns undefined', async () => {
    mockSendAndWait.mockResolvedValue(undefined)

    const evaluator = await createEvaluator()
    const result = await evaluator.runSelection(defaultOptions)

    expect(result).toEqual({
      loaded: false,
      skillName: null,
      raw: '',
    })
  })

  it('disconnects session and stops client after completion', async () => {
    mockSendAndWait.mockResolvedValue({ data: { content: 'done' } })

    const evaluator = await createEvaluator()
    await evaluator.runSelection(defaultOptions)

    expect(mockDisconnect).toHaveBeenCalled()
    expect(mockStop).toHaveBeenCalled()
  })

  it('throws immediately when signal is already aborted', async () => {
    const evaluator = await createEvaluator()

    await expect(
      evaluator.runSelection({ ...defaultOptions, signal: AbortSignal.abort() }),
    ).rejects.toThrow('Aborted')
  })

  it('calls session.on when onEvent is provided', async () => {
    mockSendAndWait.mockResolvedValue({ data: { content: 'done' } })
    const onEvent = vi.fn()

    const evaluator = await createEvaluator()
    await evaluator.runSelection({ ...defaultOptions, onEvent })

    expect(mockOn).toHaveBeenCalledWith(expect.any(Function))
  })
})
