import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/messages'
import { z } from 'zod/v4'
import { JUDGE_SYSTEM_MESSAGE } from '../shared/prompts.js'
import { buildJudgeUserMessage, validateAndBuildResult } from '../shared/judge-utils.js'
import type { Judge, JudgeInput, JudgeResult } from '../types.js'

const DEFAULT_MODEL = 'claude-sonnet-4-5'
const SUBMIT_TOOL_NAME = 'submit_evaluation'
const MAX_OUTPUT_TOKENS = 4096

const EvaluationSchema = z.object({
  criteria_scores: z.array(
    z.object({
      name: z.string(),
      score: z.number().min(0).max(1),
      reasoning: z.string(),
    }),
  ),
})

function buildSubmitEvaluationTool(criteriaNames: string[]): Tool {
  return {
    name: SUBMIT_TOOL_NAME,
    description: 'Submit your evaluation scores for each criterion.',
    input_schema: {
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
  }
}

export class AnthropicJudge implements Judge {
  private readonly model: string

  constructor(model?: string) {
    this.model = model ?? DEFAULT_MODEL
  }

  async evaluate(input: JudgeInput): Promise<JudgeResult> {
    const client = new Anthropic()
    const criteriaNames = input.criteria.map(c => c.name)
    const tool = buildSubmitEvaluationTool(criteriaNames)

    const response = await client.messages.create({
      model: this.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: JUDGE_SYSTEM_MESSAGE,
      messages: [{ role: 'user', content: buildJudgeUserMessage(input) }],
      tools: [tool],
      tool_choice: { type: 'tool', name: SUBMIT_TOOL_NAME },
    })

    const toolUseBlock = response.content.find(
      block => block.type === 'tool_use' && block.name === SUBMIT_TOOL_NAME,
    )

    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      throw new Error('Judge did not return a tool_use block for submit_evaluation')
    }

    const parsed = EvaluationSchema.parse(toolUseBlock.input)
    return validateAndBuildResult(parsed, input, this.model)
  }
}
