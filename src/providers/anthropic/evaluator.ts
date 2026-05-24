import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/messages'
import { SELECTION_SYSTEM_MESSAGE } from '../shared/prompts.js'
import type { Evaluator, SelectionResult, SelectionRunOptions } from '../types.js'

const DEFAULT_MODEL = 'claude-haiku-4-5'
const LOAD_SKILL_TOOL_NAME = 'load_skill'
// 1024 is enough for either a tool_use block (small JSON input) or a brief
// "I can handle this directly" reply. Generous enough to avoid truncation
// on either path without inviting the model to ramble.
const MAX_OUTPUT_TOKENS = 1024

function buildLoadSkillTool(skills: Array<{ name: string; description: string }>): Tool {
  const skillList = skills.map(skill => `- ${skill.name}: ${skill.description}`).join('\n')
  return {
    name: LOAD_SKILL_TOOL_NAME,
    description: `Load a skill to help with the current task.\n\nAvailable skills:\n${skillList}`,
    input_schema: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: 'The name of the skill to load',
          enum: skills.map(skill => skill.name),
        },
      },
      required: ['skill_name'],
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

export class AnthropicEvaluator implements Evaluator {
  async runSelection(options: SelectionRunOptions): Promise<SelectionResult> {
    const { signal, onEvent } = options

    if (signal?.aborted) {
      throw new Error('Aborted')
    }

    const model = options.model ?? DEFAULT_MODEL
    const client = new Anthropic()
    const tool = buildLoadSkillTool(options.skills)

    emit(onEvent, 'request_start', { provider: 'anthropic', model })

    const response = await client.messages.create(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SELECTION_SYSTEM_MESSAGE,
        messages: [{ role: 'user', content: options.prompt }],
        tools: [tool],
        tool_choice: { type: 'auto' },
      },
      {
        ...(signal && { signal }),
        timeout: options.timeout,
      },
    )

    let skillName: string | null = null
    const textParts: string[] = []

    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === LOAD_SKILL_TOOL_NAME) {
        const input = block.input as { skill_name?: unknown }
        if (typeof input?.skill_name === 'string') {
          skillName = input.skill_name
        }
      } else if (block.type === 'text') {
        textParts.push(block.text)
      }
    }

    const raw = textParts.join('')

    if (skillName !== null) {
      emit(onEvent, 'response', {
        provider: 'anthropic',
        toolCalled: true,
        skillName,
        stopReason: response.stop_reason ?? null,
      })
      return { loaded: true, skillName, raw }
    }

    emit(onEvent, 'response', {
      provider: 'anthropic',
      toolCalled: false,
      skillName: null,
      stopReason: response.stop_reason ?? null,
    })
    return { loaded: false, skillName: null, raw }
  }
}
