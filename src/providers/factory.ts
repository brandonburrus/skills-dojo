import { DojoError } from '../errors.js'
import type { DojoConfig } from '../types.js'
import { AnthropicEvaluator } from './anthropic/evaluator.js'
import { CopilotEvaluator } from './copilot/evaluator.js'
import { OpenAIEvaluator } from './openai/evaluator.js'
import type { Evaluator } from './types.js'
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
