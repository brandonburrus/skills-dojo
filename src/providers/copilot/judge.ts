import { CopilotClient, approveAll } from '@github/copilot-sdk'
import type { Tool } from '@github/copilot-sdk'
import { z } from 'zod/v4'
import { JUDGE_SYSTEM_MESSAGE } from '../shared/prompts.js'
import { buildJudgeUserMessage, validateAndBuildResult } from '../shared/judge-utils.js'
import type { Judge, JudgeInput, JudgeResult } from '../types.js'

const DEFAULT_MODEL = 'gpt-4.1'

const CriterionScoreSchema = z.object({
  name: z.string(),
  score: z.number().min(0).max(1),
  reasoning: z.string(),
})

const EvaluationSchema = z.object({
  criteria_scores: z.array(CriterionScoreSchema),
})

type EvaluationPayload = z.infer<typeof EvaluationSchema>

interface EvaluationCapture {
  result: EvaluationPayload | null
}

function buildSubmitEvaluationTool(
  criteriaNames: string[],
  capture: EvaluationCapture,
): Tool<{ criteria_scores: Array<{ name: string; score: number; reasoning: string }> }> {
  return {
    name: 'submit_evaluation',
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
    handler: args => {
      const parsed = EvaluationSchema.parse(args)
      capture.result = parsed
      return 'Evaluation submitted successfully.'
    },
    skipPermission: true,
  }
}

export class CopilotJudge implements Judge {
  private readonly model: string

  constructor(model?: string) {
    this.model = model ?? DEFAULT_MODEL
  }

  async evaluate(input: JudgeInput): Promise<JudgeResult> {
    const existing = process.env.NODE_OPTIONS ?? ''
    if (!existing.includes('--disable-warning=ExperimentalWarning')) {
      process.env.NODE_OPTIONS = `${existing} --disable-warning=ExperimentalWarning`.trim()
    }

    const client = new CopilotClient()
    try {
      const criteriaNames = input.criteria.map(c => c.name)
      const capture: EvaluationCapture = { result: null }
      const submitEvaluationTool = buildSubmitEvaluationTool(criteriaNames, capture)

      const session = await client.createSession({
        onPermissionRequest: approveAll,
        systemMessage: {
          mode: 'replace',
          content: JUDGE_SYSTEM_MESSAGE,
        },
        tools: [submitEvaluationTool as Tool],
        streaming: true,
        ...(this.model && { model: this.model }),
      })

      let modelSwitchError: Error | null = null
      session.on(event => {
        if (
          event.type === 'session.model_change' &&
          'data' in event &&
          event.data !== null &&
          typeof event.data === 'object'
        ) {
          const data = event.data as { newModel?: string }
          if (data.newModel && data.newModel !== this.model) {
            modelSwitchError = new Error(
              `Copilot switched model from requested "${this.model}" to "${data.newModel}". ` +
                'Aborting — model mismatch invalidates results.',
            )
            void session.abort()
          }
        }
      })

      try {
        await session.sendAndWait({ prompt: buildJudgeUserMessage(input) })
        if (modelSwitchError) {
          throw modelSwitchError
        }
      } catch (err) {
        if (modelSwitchError) {
          throw modelSwitchError
        }
        throw err
      } finally {
        await session.disconnect()
      }

      if (!capture.result) {
        throw new Error('Judge did not call submit_evaluation tool')
      }

      return validateAndBuildResult(capture.result, input, this.model)
    } finally {
      await client.stop()
    }
  }
}
