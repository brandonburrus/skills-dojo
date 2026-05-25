import { CopilotClient, approveAll } from '@github/copilot-sdk'
import type { Tool } from '@github/copilot-sdk'
import { z } from 'zod/v4'
import { JUDGE_SYSTEM_MESSAGE } from '../shared/prompts.js'
import type { Judge, JudgeInput, JudgeResult } from '../types.js'

const DEFAULT_MODEL = 'gpt-4.1'
const MAX_TOOL_OUTPUT_LENGTH = 5000

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

function buildUserMessage(input: JudgeInput): string {
  const sections: string[] = []

  sections.push(`## Task Prompt\n\n${input.prompt}`)
  sections.push(`## Skill Instructions\n\n${input.skillContent}`)

  sections.push(`## Agent Artifact\n\n### Final Message\n\n${input.artifact.finalMessage}`)

  if (input.artifact.toolCalls.length > 0) {
    const calls = input.artifact.toolCalls
      .map(tc => {
        const inputStr = JSON.stringify(tc.input)
        const outputStr = JSON.stringify(tc.output)
        const truncatedOutput =
          outputStr.length > MAX_TOOL_OUTPUT_LENGTH
            ? `${outputStr.slice(0, MAX_TOOL_OUTPUT_LENGTH)}... [truncated]`
            : outputStr
        return `- **${tc.tool}**\n  Input: ${inputStr}\n  Output: ${truncatedOutput}`
      })
      .join('\n')
    sections.push(`### Tool Calls\n\n${calls}`)
  }

  if (input.artifact.fsDiff.length > 0) {
    const diffs = input.artifact.fsDiff
      .map(d => {
        const header = `- **${d.type}**: ${d.path}`
        return d.content ? `${header}\n\`\`\`\n${d.content}\n\`\`\`` : header
      })
      .join('\n')
    sections.push(`### Filesystem Changes\n\n${diffs}`)
  }

  if (input.golden) {
    let goldenSection = '## Golden Reference\n\n'
    if (input.golden.notes) {
      goldenSection += `### Notes\n\n${input.golden.notes}\n\n`
    }
    if (input.golden.files && input.golden.files.length > 0) {
      const files = input.golden.files
        .map(f => `- **${f.path}**\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n')
      goldenSection += `### Expected Files\n\n${files}`
    }
    sections.push(goldenSection)
  }

  const criteriaList = input.criteria
    .map(c => `- **${c.name}** (threshold: ${c.threshold}): ${c.description}`)
    .join('\n')
  sections.push(`## Criteria to Evaluate\n\n${criteriaList}`)

  return sections.join('\n\n')
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
        await session.sendAndWait({ prompt: buildUserMessage(input) })
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

      const parsed = capture.result
      const expectedNames = new Set(input.criteria.map(c => c.name))
      const returnedNames = parsed.criteria_scores.map(cs => cs.name)
      const returnedSet = new Set(returnedNames)

      if (returnedNames.length !== returnedSet.size) {
        const duplicates = returnedNames.filter((n, i) => returnedNames.indexOf(n) !== i)
        throw new Error(`Judge returned duplicate criteria: ${duplicates.join(', ')}`)
      }

      const missing = [...expectedNames].filter(n => !returnedSet.has(n))
      if (missing.length > 0) {
        throw new Error(`Judge did not score all criteria. Missing: ${missing.join(', ')}`)
      }

      const unexpected = [...returnedSet].filter(n => !expectedNames.has(n))
      if (unexpected.length > 0) {
        throw new Error(`Judge returned unexpected criteria: ${unexpected.join(', ')}`)
      }

      const thresholdMap = new Map(input.criteria.map(c => [c.name, c.threshold]))

      const perCriterion = parsed.criteria_scores.map(cs => {
        const threshold = thresholdMap.get(cs.name)!
        return {
          name: cs.name,
          score: cs.score,
          passed: cs.score >= threshold,
          reasoning: cs.reasoning,
        }
      })

      return {
        perCriterion,
        overallPassed: perCriterion.every(c => c.passed),
        judgeModel: this.model,
      }
    } finally {
      await client.stop()
    }
  }
}
