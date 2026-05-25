import { DojoError } from '../errors.js'
import type { DojoConfig } from '../types.js'
import { AnthropicEvaluator } from './anthropic/evaluator.js'
import { AnthropicJudge } from './anthropic/judge.js'
import { CopilotEvaluator } from './copilot/evaluator.js'
import { CopilotJudge } from './copilot/judge.js'
import { OpenAIEvaluator } from './openai/evaluator.js'
import { OpenAIJudge } from './openai/judge.js'
import type { Evaluator, Judge } from './types.js'
import { VercelEvaluator } from './vercel/evaluator.js'
import { VercelJudge } from './vercel/judge.js'

export type EvaluatorProvider = DojoConfig['model']['provider']

/**
 * Construct the Judge implementation for a given provider literal.
 */
export function createJudge(provider: EvaluatorProvider, model?: string): Judge {
  switch (provider) {
    case 'anthropic':
      return new AnthropicJudge(model)
    case 'openai':
      return new OpenAIJudge(model)
    case 'copilot':
      return new CopilotJudge(model)
    case 'vercel':
      return new VercelJudge(model)
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
