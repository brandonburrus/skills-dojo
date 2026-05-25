import { DojoError } from '../errors.js'
import type { DojoConfig } from '../types.js'
import { AnthropicEvaluator } from './anthropic/evaluator.js'
import { AnthropicJudge } from './anthropic/judge.js'
import { CopilotEvaluator } from './copilot/evaluator.js'
import { OpenAIEvaluator } from './openai/evaluator.js'
import type { Evaluator, Judge } from './types.js'
import { VercelEvaluator } from './vercel/evaluator.js'

export type EvaluatorProvider = DojoConfig['model']['provider']

/**
 * Construct the Evaluator implementation for a given provider literal.
 *
 * The provider value is constrained by the config schema enum
 * (see src/schemas/config.ts), so the default branch is unreachable in
 * normal flow — it exists as defense-in-depth so that adding a new
 * provider literal to the schema without wiring it here fails loudly
 * rather than silently falling back to a default.
 */
/**
 * Construct the Judge implementation for a given provider literal.
 * Only Anthropic is implemented today; other providers will throw until wired.
 */
export function createJudge(provider: EvaluatorProvider, model?: string): Judge {
  switch (provider) {
    case 'anthropic':
      return new AnthropicJudge(model)
    case 'copilot':
    case 'openai':
    case 'vercel':
      throw new DojoError(
        `Judge not yet implemented for provider "${provider}". Use "anthropic" for now.`,
      )
    default: {
      const exhaustiveCheck: never = provider
      throw new DojoError(`Unknown judge provider: "${String(exhaustiveCheck)}".`)
    }
  }
}

export function createEvaluator(provider: EvaluatorProvider): Evaluator {
  switch (provider) {
    case 'copilot':
      return new CopilotEvaluator()
    case 'openai':
      return new OpenAIEvaluator()
    case 'anthropic':
      return new AnthropicEvaluator()
    case 'vercel':
      return new VercelEvaluator()
    default: {
      const exhaustiveCheck: never = provider
      throw new DojoError(`Unknown evaluator provider: "${String(exhaustiveCheck)}".`)
    }
  }
}
