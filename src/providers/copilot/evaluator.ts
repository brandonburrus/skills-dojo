import { CopilotClient, approveAll } from '@github/copilot-sdk'
import type { Tool } from '@github/copilot-sdk'
import type { Evaluator, SelectionResult, SelectionRunOptions } from '../types.js'

const SYSTEM_MESSAGE = [
  'You are an AI assistant.',
  'You have access to skills that you can load to help with tasks.',
  'Available skills are listed in the load_skill tool.',
  'Only load a skill if you genuinely need it for the task.',
  'If the task is simple enough to handle from your general knowledge, just respond directly.',
].join(' ')

function buildSkillDescription(skills: Array<{ name: string; description: string }>): string {
  const skillList = skills.map(s => `- ${s.name}: ${s.description}`).join('\n')
  return `Load a skill to help with the current task.\n\nAvailable skills:\n${skillList}`
}

interface ToolCallCapture {
  skillName: string | null
}

function createLoadSkillTool(
  skills: Array<{ name: string; description: string }>,
  capture: ToolCallCapture,
  onLoaded?: () => void,
): Tool<{ skill_name: string }> {
  return {
    name: 'load_skill',
    description: buildSkillDescription(skills),
    parameters: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: 'The name of the skill to load',
          enum: skills.map(s => s.name),
        },
      },
      required: ['skill_name'],
    },
    handler: args => {
      capture.skillName = args.skill_name
      onLoaded?.()
      return `Skill "${args.skill_name}" loaded successfully.`
    },
    skipPermission: true,
  }
}

export class CopilotEvaluator implements Evaluator {
  async runSelection(options: SelectionRunOptions): Promise<SelectionResult> {
    const { signal, onEvent, earlyBailout } = options

    if (signal?.aborted) {
      throw new Error('Aborted')
    }

    const existing = process.env.NODE_OPTIONS ?? ''
    if (!existing.includes('--disable-warning=ExperimentalWarning')) {
      process.env.NODE_OPTIONS = `${existing} --disable-warning=ExperimentalWarning`.trim()
    }

    const client = new CopilotClient()
    try {
      const capture: ToolCallCapture = { skillName: null }
      let sessionRef: { abort: () => Promise<void> } | null = null

      const onLoaded = earlyBailout
        ? () => {
            void sessionRef?.abort()
          }
        : undefined

      const loadSkillTool = createLoadSkillTool(options.skills, capture, onLoaded)

      const session = await client.createSession({
        onPermissionRequest: approveAll,
        systemMessage: {
          mode: 'replace',
          content: SYSTEM_MESSAGE,
        },
        tools: [loadSkillTool as Tool],
        streaming: true,
        ...(options.model && { model: options.model }),
      })

      sessionRef = session

      if (onEvent) {
        session.on(event => {
          onEvent(event as { type: string; [key: string]: unknown })
        })
      }

      const onAbort = (): void => {
        void session.abort()
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      if (signal?.aborted) {
        signal.removeEventListener('abort', onAbort)
        await session.disconnect()
        throw new Error('Aborted')
      }

      try {
        let raw = ''
        try {
          const response = await session.sendAndWait({ prompt: options.prompt }, options.timeout)
          raw = response?.data.content ?? ''
        } catch (err) {
          // If early bailout triggered the abort and we captured a skill, that's a success
          if (capture.skillName !== null) {
            return { loaded: true, skillName: capture.skillName, raw: '' }
          }
          throw err
        }

        if (capture.skillName !== null) {
          return { loaded: true, skillName: capture.skillName, raw }
        }

        return { loaded: false, skillName: null, raw }
      } finally {
        signal?.removeEventListener('abort', onAbort)
        await session.disconnect()
      }
    } finally {
      await client.stop()
    }
  }
}
