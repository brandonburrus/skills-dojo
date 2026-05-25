import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import { generateText, tool, type LanguageModel } from 'ai'
import { z } from 'zod/v4'
import { JUDGE_SYSTEM_MESSAGE } from '../shared/prompts.js'
import { buildJudgeUserMessage, validateAndBuildResult } from '../shared/judge-utils.js'
import type { Judge, JudgeInput, JudgeResult } from '../types.js'

const DEFAULT_MODEL = 'openai/gpt-4o-mini'
const SUBMIT_TOOL_NAME = 'submit_evaluation'

const EvaluationSchema = z.object({
  criteria_scores: z.array(
    z.object({
      name: z.string(),
      score: z.number().min(0).max(1),
      reasoning: z.string(),
    }),
  ),
})

function resolveModel(modelString: string): LanguageModel {
  const separator = modelString.indexOf('/')
  if (separator === -1) {
    throw new Error(`Invalid model string "${modelString}". Expected format: <provider>/<model-id>`)
  }

  const providerName = modelString.slice(0, separator)
  const modelId = modelString.slice(separator + 1)

  switch (providerName) {
    case 'openai':
      return openai(modelId)
    case 'anthropic':
      return anthropic(modelId)
    default:
      throw new Error(`Unsupported Vercel AI SDK provider: "${providerName}"`)
  }
}

export class VercelJudge implements Judge {
  private readonly modelString: string

  constructor(model?: string) {
    this.modelString = model ?? DEFAULT_MODEL
  }

  async evaluate(input: JudgeInput): Promise<JudgeResult> {
    const model = resolveModel(this.modelString)
    const criteriaNames = input.criteria.map(c => c.name)

    const result = await generateText({
      model,
      system: JUDGE_SYSTEM_MESSAGE,
      messages: [{ role: 'user', content: buildJudgeUserMessage(input) }],
      tools: {
        [SUBMIT_TOOL_NAME]: tool({
          description: 'Submit your evaluation scores for each criterion.',
          inputSchema: z.object({
            criteria_scores: z
              .array(
                z.object({
                  name: z
                    .string()
                    .describe(`The criterion name. Must be one of: ${criteriaNames.join(', ')}`),
                  score: z.number().min(0).max(1).describe('Score from 0.0 to 1.0'),
                  reasoning: z
                    .string()
                    .describe('Specific evidence from the artifact justifying this score.'),
                }),
              )
              .describe('One score entry per criterion.'),
          }),
        }),
      },
      toolChoice: { type: 'tool', toolName: SUBMIT_TOOL_NAME },
    })

    const toolCall = result.toolCalls[0]
    if (!toolCall || toolCall.toolName !== SUBMIT_TOOL_NAME) {
      throw new Error('Judge did not return a tool call for submit_evaluation')
    }

    const parsed = EvaluationSchema.parse(toolCall.input)
    return validateAndBuildResult(parsed, input, this.modelString)
  }
}
