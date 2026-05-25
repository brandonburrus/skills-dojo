import OpenAI from 'openai'
import { z } from 'zod/v4'
import { JUDGE_SYSTEM_MESSAGE } from '../shared/prompts.js'
import { buildJudgeUserMessage, validateAndBuildResult } from '../shared/judge-utils.js'
import type { Judge, JudgeInput, JudgeResult } from '../types.js'

const DEFAULT_MODEL = 'gpt-4o-mini'
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

function buildSubmitEvaluationTool(
  criteriaNames: string[],
): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: SUBMIT_TOOL_NAME,
      description: 'Submit your evaluation scores for each criterion.',
      parameters: {
        type: 'object',
        properties: {
          criteria_scores: {
            type: 'array',
            description: 'One score entry per criterion.',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: `The criterion name. Must be one of: ${criteriaNames.join(', ')}`,
                },
                score: {
                  type: 'number',
                  description: 'Score from 0.0 to 1.0',
                },
                reasoning: {
                  type: 'string',
                  description: 'Specific evidence from the artifact justifying this score.',
                },
              },
              required: ['name', 'score', 'reasoning'],
            },
          },
        },
        required: ['criteria_scores'],
      },
    },
  }
}

export class OpenAIJudge implements Judge {
  private readonly model: string

  constructor(model?: string) {
    this.model = model ?? DEFAULT_MODEL
  }

  async evaluate(input: JudgeInput): Promise<JudgeResult> {
    const client = new OpenAI()
    const criteriaNames = input.criteria.map(c => c.name)
    const tool = buildSubmitEvaluationTool(criteriaNames)

    const response = await client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM_MESSAGE },
        { role: 'user', content: buildJudgeUserMessage(input) },
      ],
      tools: [tool],
      tool_choice: {
        type: 'function',
        function: { name: SUBMIT_TOOL_NAME },
      },
    })

    const message = response.choices[0]?.message
    const toolCall = message?.tool_calls?.find(
      tc => 'function' in tc && tc.function.name === SUBMIT_TOOL_NAME,
    )

    if (!toolCall || !('function' in toolCall)) {
      throw new Error('Judge did not return a tool call for submit_evaluation')
    }

    const parsed = EvaluationSchema.parse(JSON.parse(toolCall.function.arguments))
    return validateAndBuildResult(parsed, input, this.model)
  }
}
