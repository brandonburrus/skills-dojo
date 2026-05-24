import { describe, expect, it, vi } from 'vitest'
import { DojoError } from '../../src/errors.js'

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: class {
    async createSession() {
      return {}
    }
    async stop() {}
  },
  approveAll: vi.fn(),
}))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: vi.fn() } }
  },
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: vi.fn() }
  },
}))

vi.mock('ai', () => ({
  generateText: vi.fn(),
  tool: (def: unknown) => def,
}))

vi.mock('@ai-sdk/openai', () => ({
  openai: (modelId: string) => ({ provider: 'openai', modelId }),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: (modelId: string) => ({ provider: 'anthropic', modelId }),
}))

describe('createEvaluator', () => {
  it('returns a CopilotEvaluator for "copilot"', async () => {
    const { createEvaluator } = await import('../../src/providers/factory.js')
    const { CopilotEvaluator } = await import('../../src/providers/copilot/evaluator.js')

    const evaluator = createEvaluator('copilot')

    expect(evaluator).toBeInstanceOf(CopilotEvaluator)
  })

  it('returns an OpenAIEvaluator for "openai"', async () => {
    const { createEvaluator } = await import('../../src/providers/factory.js')
    const { OpenAIEvaluator } = await import('../../src/providers/openai/evaluator.js')

    const evaluator = createEvaluator('openai')

    expect(evaluator).toBeInstanceOf(OpenAIEvaluator)
  })

  it('returns an AnthropicEvaluator for "anthropic"', async () => {
    const { createEvaluator } = await import('../../src/providers/factory.js')
    const { AnthropicEvaluator } = await import('../../src/providers/anthropic/evaluator.js')

    const evaluator = createEvaluator('anthropic')

    expect(evaluator).toBeInstanceOf(AnthropicEvaluator)
  })

  it('returns a VercelEvaluator for "vercel"', async () => {
    const { createEvaluator } = await import('../../src/providers/factory.js')
    const { VercelEvaluator } = await import('../../src/providers/vercel/evaluator.js')

    const evaluator = createEvaluator('vercel')

    expect(evaluator).toBeInstanceOf(VercelEvaluator)
  })

  it('throws DojoError for an unknown provider literal', async () => {
    const { createEvaluator } = await import('../../src/providers/factory.js')

    // Cast through `unknown` to bypass the union type — defends against future
    // provider literals being added to the schema without wiring them here.
    const callWithBadProvider = (): unknown =>
      createEvaluator('not-a-real-provider' as unknown as 'copilot')

    expect(callWithBadProvider).toThrow(DojoError)
    expect(callWithBadProvider).toThrow(/Unknown evaluator provider/)
  })
})
