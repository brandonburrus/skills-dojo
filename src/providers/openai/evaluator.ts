import OpenAI from 'openai'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import { SELECTION_SYSTEM_MESSAGE } from '../shared/prompts.js'
import type { Evaluator, SelectionResult, SelectionRunOptions } from '../types.js'

const DEFAULT_MODEL = 'gpt-4o-mini'
const LOAD_SKILL_TOOL_NAME = 'load_skill'

function buildLoadSkillTool(
  skills: Array<{ name: string; description: string }>,
): ChatCompletionTool {
  const skillList = skills.map(skill => `- ${skill.name}: ${skill.description}`).join('\n')
  return {
    type: 'function',
    function: {
      name: LOAD_SKILL_TOOL_NAME,
      description: `Load a skill to help with the current task.\n\nAvailable skills:\n${skillList}`,
      parameters: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            description: 'The name of the skill to load',
            enum: skills.map(skill => skill.name),
          },
        },
        required: ['skill_name'],
        additionalProperties: false,
      },
    },
  }
}

function emit(
  onEvent: SelectionRunOptions['onEvent'],
  type: string,
  data: Record<string, unknown>,
): void {
  if (!onEvent) return
  onEvent({ type, data })
}

export class OpenAIEvaluator implements Evaluator {
  async runSelection(options: SelectionRunOptions): Promise<SelectionResult> {
    const { signal, onEvent } = options

    if (signal?.aborted) {
      throw new Error('Aborted')
    }

    const model = options.model ?? DEFAULT_MODEL
    const client = new OpenAI()
    const tool = buildLoadSkillTool(options.skills)

    emit(onEvent, 'request_start', { provider: 'openai', model })

    const response = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: SELECTION_SYSTEM_MESSAGE },
          { role: 'user', content: options.prompt },
        ],
        tools: [tool],
        tool_choice: 'auto',
      },
      {
        ...(signal && { signal }),
        timeout: options.timeout,
      },
    )

    const choice = response.choices[0]
    const message = choice?.message
    const raw = message?.content ?? ''

    const loadSkillCall = message?.tool_calls?.find(
      call => call.type === 'function' && call.function.name === LOAD_SKILL_TOOL_NAME,
    )

    if (loadSkillCall && loadSkillCall.type === 'function') {
      let skillName: string | null = null
      try {
        const parsed = JSON.parse(loadSkillCall.function.arguments) as { skill_name?: unknown }
        if (typeof parsed.skill_name === 'string') {
          skillName = parsed.skill_name
        }
      } catch {
        // Malformed arguments — treat as a tool call we can't act on, fall through to no-skill result.
      }

      if (skillName !== null) {
        emit(onEvent, 'response', {
          provider: 'openai',
          toolCalled: true,
          skillName,
          finishReason: choice?.finish_reason ?? null,
        })
        return { loaded: true, skillName, raw }
      }
    }

    emit(onEvent, 'response', {
      provider: 'openai',
      toolCalled: false,
      skillName: null,
      finishReason: choice?.finish_reason ?? null,
    })
    return { loaded: false, skillName: null, raw }
  }
}
