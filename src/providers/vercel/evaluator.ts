import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { generateText, tool, type LanguageModel } from 'ai'
import { z } from 'zod/v4'
import { DojoError } from '../../errors.js'
import { SELECTION_SYSTEM_MESSAGE } from '../shared/prompts.js'
import type { Evaluator, SelectionResult, SelectionRunOptions } from '../types.js'

const DEFAULT_MODEL = 'openai/gpt-4o-mini'
const LOAD_SKILL_TOOL_NAME = 'load_skill'

/**
 * Parse a Vercel AI SDK model string of the form `<provider>/<model-id>` into
 * a concrete `LanguageModel` instance. We deliberately require the explicit
 * provider prefix instead of inferring it from the model id — the Vercel AI
 * SDK is a meta-SDK and the same model name can legitimately exist across
 * multiple providers, so silent routing would be a footgun.
 */
function resolveModel(modelString: string): LanguageModel {
  const separator = modelString.indexOf('/')
  if (separator === -1) {
    throw new DojoError(
      `Vercel AI SDK model must be in the form "<provider>/<model-id>" (e.g. "openai/gpt-4o-mini"); got "${modelString}".`,
    )
  }

  const providerId = modelString.slice(0, separator)
  const modelId = modelString.slice(separator + 1)

  if (!modelId) {
    throw new DojoError(
      `Vercel AI SDK model id is empty after the "/" separator in "${modelString}".`,
    )
  }

  switch (providerId) {
    case 'openai':
      return openai(modelId)
    case 'anthropic':
      return anthropic(modelId)
    default:
      throw new DojoError(
        `Unsupported Vercel AI SDK underlying provider: "${providerId}". Supported providers: "openai", "anthropic".`,
      )
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

/**
 * Build a non-empty zod enum from the configured skill names so the model
 * cannot invent a skill that doesn't exist. Asserted as a non-empty tuple
 * because `z.enum` requires at least one entry; callers should never invoke
 * `runSelection` with an empty skill list.
 */
function buildSkillEnum(skillNames: readonly string[]): z.ZodEnum<Record<string, string>> {
  if (skillNames.length === 0) {
    throw new DojoError('Vercel AI SDK evaluator received an empty skill list.')
  }
  return z.enum(skillNames as unknown as [string, ...string[]])
}

/**
 * Merge the caller's abort signal (if any) with a timeout-based signal so the
 * Vercel AI SDK call respects both. Vercel's `generateText` accepts a single
 * `abortSignal` so we combine them with `AbortSignal.any` (available on Node
 * 20+ per the `engines` field in package.json).
 */
function buildAbortSignal(userSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return userSignal ? AbortSignal.any([userSignal, timeoutSignal]) : timeoutSignal
}

export class VercelEvaluator implements Evaluator {
  async runSelection(options: SelectionRunOptions): Promise<SelectionResult> {
    const { signal, onEvent } = options

    if (signal?.aborted) {
      throw new Error('Aborted')
    }

    const modelString = options.model ?? DEFAULT_MODEL
    const model = resolveModel(modelString)
    const skillList = options.skills.map(s => `- ${s.name}: ${s.description}`).join('\n')
    const skillEnum = buildSkillEnum(options.skills.map(s => s.name))

    emit(onEvent, 'request_start', { provider: 'vercel', model: modelString })

    const result = await generateText({
      model,
      system: SELECTION_SYSTEM_MESSAGE,
      prompt: options.prompt,
      tools: {
        [LOAD_SKILL_TOOL_NAME]: tool({
          description: `Load a skill to help with the current task.\n\nAvailable skills:\n${skillList}`,
          inputSchema: z.object({
            skill_name: skillEnum.describe('The name of the skill to load'),
          }),
        }),
      },
      abortSignal: buildAbortSignal(signal, options.timeout),
    })

    const raw = result.text ?? ''
    const loadSkillCall = result.toolCalls?.find(call => call.toolName === LOAD_SKILL_TOOL_NAME)

    if (loadSkillCall) {
      const input = loadSkillCall.input as { skill_name?: unknown }
      if (typeof input?.skill_name === 'string') {
        emit(onEvent, 'response', {
          provider: 'vercel',
          toolCalled: true,
          skillName: input.skill_name,
          finishReason: result.finishReason ?? null,
        })
        return { loaded: true, skillName: input.skill_name, raw }
      }
    }

    emit(onEvent, 'response', {
      provider: 'vercel',
      toolCalled: false,
      skillName: null,
      finishReason: result.finishReason ?? null,
    })
    return { loaded: false, skillName: null, raw }
  }
}
