#!/usr/bin/env tsx
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

const MAX_TURNS = 20
const TOOL_TIMEOUT_MS = 30_000

interface ToolCall {
  tool: string
  input: Record<string, unknown>
  output: string
}

interface Artifact {
  finalMessage: string
  toolCalls: ToolCall[]
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

/**
 * Resolves a user-provided path against allowed base directories.
 * Prevents directory traversal by verifying the resolved path starts with one of the allowed bases.
 */
function resolveAndValidatePath(inputPath: string, allowedBases: string[]): string {
  const resolved = path.resolve(allowedBases[0]!, inputPath)

  const isAllowed = allowedBases.some(base => resolved.startsWith(base))
  if (!isAllowed) {
    throw new Error(`Path "${inputPath}" resolves outside allowed directories`)
  }

  return resolved
}

function executeBash(command: string, cwd: string): string {
  try {
    const output = execSync(command, {
      cwd,
      timeout: TOOL_TIMEOUT_MS,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return output
  } catch (error: unknown) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'stderr' in error &&
      typeof (error as { stderr: unknown }).stderr === 'string'
    ) {
      return (error as { stderr: string }).stderr
    }
    if (error instanceof Error) {
      return error.message
    }
    return 'Unknown error executing command'
  }
}

function executeReadFile(filePath: string, allowedBases: string[]): string {
  const resolved = resolveAndValidatePath(filePath, allowedBases)
  return readFileSync(resolved, 'utf-8')
}

function executeWriteFile(filePath: string, content: string, sandboxDir: string): string {
  const resolved = resolveAndValidatePath(filePath, [sandboxDir])
  mkdirSync(path.dirname(resolved), { recursive: true })
  writeFileSync(resolved, content, 'utf-8')
  return `File written: ${filePath}`
}

function executeListFiles(filePath: string, allowedBases: string[]): string {
  const resolved = resolveAndValidatePath(filePath, allowedBases)
  const entries = readdirSync(resolved, { withFileTypes: true })
  return entries.map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name)).join('\n')
}

function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  sandboxDir: string,
  skillDir: string,
): string {
  const allowedReadBases = [sandboxDir, skillDir]

  switch (toolName) {
    case 'bash':
      return executeBash(input.command as string, sandboxDir)
    case 'read_file':
      return executeReadFile(input.path as string, allowedReadBases)
    case 'write_file':
      return executeWriteFile(input.path as string, input.content as string, sandboxDir)
    case 'list_files':
      return executeListFiles(input.path as string, allowedReadBases)
    default:
      return `Unknown tool: ${toolName}`
  }
}

const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'bash',
    description: 'Execute a shell command in the workspace directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace directory',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file, creating directories as needed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace directory',
        },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories at a given path.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to the workspace',
        },
      },
      required: ['path'],
    },
  },
]

async function main(): Promise<void> {
  const sandboxDir = requireEnv('DOJO_SANDBOX_DIR')
  const skillDir = requireEnv('DOJO_SKILL_DIR')
  const prompt = requireEnv('DOJO_PROMPT')
  const model = requireEnv('DOJO_MODEL')
  const artifactPath = requireEnv('DOJO_ARTIFACT_PATH')

  const skillContent = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8')

  const systemPrompt = [
    'You are an AI agent working in a project directory.',
    '',
    'The following skill has been loaded to help you with this task:',
    '',
    '<skill>',
    skillContent,
    '</skill>',
    '',
    `Skill resources (scripts, references, assets) are available at: ${skillDir}`,
    'You may read files from that directory if you need additional context.',
    '',
    `Your working directory is: ${sandboxDir}`,
    'Complete the task using the available tools.',
  ].join('\n')

  const client = new Anthropic()
  const toolCalls: ToolCall[] = []

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]

  let finalMessage = ''

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOL_DEFINITIONS,
      messages,
    })

    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    )
    if (textBlocks.length > 0) {
      finalMessage = textBlocks[textBlocks.length - 1]!.text
    }

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )

    if (response.stop_reason === 'end_turn' && toolUseBlocks.length === 0) {
      break
    }

    if (toolUseBlocks.length === 0) {
      break
    }

    messages.push({ role: 'assistant', content: response.content })

    const toolResults: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map(block => {
      const input = block.input as Record<string, unknown>
      let output: string
      try {
        output = executeTool(block.name, input, sandboxDir, skillDir)
      } catch (error: unknown) {
        output = error instanceof Error ? error.message : 'Tool execution failed'
      }

      toolCalls.push({ tool: block.name, input, output })

      return {
        type: 'tool_result' as const,
        tool_use_id: block.id,
        content: output,
      }
    })

    messages.push({ role: 'user', content: toolResults })
  }

  const artifact: Artifact = { finalMessage, toolCalls }
  mkdirSync(path.dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf-8')
}

main().catch((error: unknown) => {
  console.error('Agent runner failed:', error)
  process.exit(1)
})
