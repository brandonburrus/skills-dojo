import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// Use the root project's zod to avoid version mismatch with astro's bundled copy.
// The schemas import zod from the root node_modules, so toJSONSchema must use the
// same instance to read .describe() metadata correctly.
const require = createRequire(import.meta.resolve('../../package.json'))
const { z } = require('zod/v4') as typeof import('zod/v4')

import {
  SelectionFileSchema,
  SelectionEvalSchema,
  DecoySchema,
  VariantSchema,
} from '../../src/schemas/eval.js'
import { DojoConfigSchema } from '../../src/schemas/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REFERENCE_DIR = join(__dirname, '..', 'src', 'content', 'docs', 'reference')

const AUTO_GENERATED_NOTE = `:::note
This page is auto-generated.
:::`

interface FieldRow {
  field: string
  type: string
  required: boolean
  default: string
  description: string
}

/** Maps sorted property-key signatures to human-readable type names. */
const objectSignatures: Record<string, string> = {}

function objectSignature(jsonSchema: Record<string, unknown>): string {
  const props = jsonSchema.properties as Record<string, unknown> | undefined
  const keys = props ? Object.keys(props) : []
  return [...keys].sort().join(',')
}

function registerObjectName(schema: zTypes.ZodType, name: string): void {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>
  const sig = objectSignature(jsonSchema)
  if (sig) {
    objectSignatures[sig] = name
  }
}

function matchObjectName(prop: Record<string, unknown>): string | null {
  const sig = objectSignature(prop)
  return sig ? (objectSignatures[sig] ?? null) : null
}

function jsonSchemaTypeToString(prop: Record<string, unknown>): string {
  if (prop.const !== undefined) {
    return `\`${JSON.stringify(prop.const)}\``
  }

  if (Array.isArray(prop.enum)) {
    return (prop.enum as string[]).map(v => `\`"${v}"\``).join(' \\| ')
  }

  if (Array.isArray(prop.anyOf)) {
    const variants = (prop.anyOf as Record<string, unknown>[]).map(jsonSchemaTypeToString)
    return variants.join(' \\| ')
  }

  if (Array.isArray(prop.oneOf)) {
    const variants = (prop.oneOf as Record<string, unknown>[]).map(jsonSchemaTypeToString)
    return variants.join(' \\| ')
  }

  if (prop.type === 'array') {
    const items = prop.items as Record<string, unknown> | undefined
    if (items) {
      const inner = jsonSchemaTypeToString(items)
      if (inner.startsWith('`') && inner.endsWith('`')) {
        return `\`${inner.slice(1, -1)}[]\``
      }
      return `${inner}[]`
    }
    return '`array`'
  }

  if (prop.type === 'object') {
    const name = matchObjectName(prop)
    if (name) return `\`${name}\``

    const additionalProperties = prop.additionalProperties as Record<string, unknown> | undefined
    if (additionalProperties) {
      return `\`Record<string, ${jsonSchemaTypeToString(additionalProperties)}>\``
    }
    return '`object`'
  }

  if (typeof prop.type === 'string') {
    return `\`${prop.type}\``
  }

  return '`unknown`'
}

function extractFields(jsonSchema: Record<string, unknown>): FieldRow[] {
  const properties = (jsonSchema['properties'] ?? {}) as Record<string, Record<string, unknown>>
  const required = new Set((jsonSchema['required'] ?? []) as string[])
  const rows: FieldRow[] = []

  for (const [key, prop] of Object.entries(properties)) {
    const description = (prop['description'] as string) ?? ''
    const hasDefault = 'default' in prop
    const defaultVal = hasDefault ? `\`${JSON.stringify(prop['default'])}\`` : '-'

    rows.push({
      field: `\`${key}\``,
      type: jsonSchemaTypeToString(prop),
      required: required.has(key) && !hasDefault,
      default: defaultVal,
      description,
    })
  }

  return rows
}

function renderTable(rows: FieldRow[]): string {
  const lines = [
    '| Field | Type | Required | Default | Description |',
    '|-------|------|----------|---------|-------------|',
  ]

  for (const row of rows) {
    lines.push(
      `| ${row.field} | ${row.type} | ${row.required ? 'Yes' : 'No'} | ${row.default} | ${row.description} |`,
    )
  }

  return lines.join('\n')
}

import type { z as zTypes } from 'zod/v4'

interface SchemaSection {
  description?: string
  schema: zTypes.ZodType
}

function renderSchemaSection(section: SchemaSection): string {
  const jsonSchema = z.toJSONSchema(section.schema) as Record<string, unknown>
  const fields = extractFields(jsonSchema)
  const parts: string[] = []

  if (section.description) {
    parts.push(section.description, '')
  }
  parts.push(renderTable(fields))

  // Render nested object properties as subsections
  const properties = (jsonSchema['properties'] ?? {}) as Record<string, Record<string, unknown>>
  for (const [key, prop] of Object.entries(properties)) {
    const resolvedProp = resolveNestedObject(prop)
    if (
      resolvedProp &&
      typeof resolvedProp === 'object' &&
      resolvedProp['type'] === 'object' &&
      resolvedProp['properties']
    ) {
      const nestedFields = extractFields(resolvedProp as Record<string, unknown>)
      if (nestedFields.length > 0) {
        parts.push('', `#### \`${key}\` fields`, '', renderTable(nestedFields))
      }
    }
  }

  return parts.join('\n')
}

/** Resolve a property that may be wrapped in anyOf (from .optional().default()) to find its object shape. */
function resolveNestedObject(prop: Record<string, unknown>): Record<string, unknown> | null {
  if (prop['type'] === 'object' && prop['properties']) {
    return prop
  }
  if (Array.isArray(prop['anyOf'])) {
    for (const variant of prop['anyOf'] as Record<string, unknown>[]) {
      if (variant['type'] === 'object' && variant['properties']) {
        return variant
      }
    }
  }
  return null
}

function writePage(
  filename: string,
  frontmatter: { title: string; description: string },
  body: string,
): void {
  const content = [
    '---',
    `title: "${frontmatter.title}"`,
    `description: "${frontmatter.description}"`,
    '---',
    '',
    AUTO_GENERATED_NOTE,
    '',
    body,
    '',
  ].join('\n')

  const filePath = join(REFERENCE_DIR, filename)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
  console.log(`Wrote ${filePath}`)
}

// Register named types so array references render as e.g. Variant[] instead of object[]
registerObjectName(VariantSchema, 'Variant')
registerObjectName(DecoySchema, 'Decoy')
registerObjectName(SelectionEvalSchema, 'SelectionEval')

// --- Generate evals.md ---

const evalsBody = [
  '## Selection File',
  '',
  renderSchemaSection({
    schema: SelectionFileSchema,
    description: 'Top-level schema for selection eval YAML files.',
  }),
  '',
  '## Selection Eval',
  '',
  renderSchemaSection({
    schema: SelectionEvalSchema,
    description: 'Schema for individual eval entries within the `evals` array.',
  }),
].join('\n')

writePage(
  'evals.md',
  {
    title: 'Eval File Reference',
    description: 'Reference for the selection eval YAML file format.',
  },
  evalsBody,
)

// --- Generate variants.md ---

const variantsBody = [
  '## Variant',
  '',
  renderSchemaSection({
    schema: VariantSchema,
    description: 'Schema for skill variants used in selection evals.',
  }),
  '',
  '## Decoy',
  '',
  renderSchemaSection({
    schema: DecoySchema,
    description: 'Schema for decoy skills that should not be selected.',
  }),
].join('\n')

writePage(
  'variants.md',
  {
    title: 'Variants Reference',
    description: 'Reference for variant and decoy schemas used in selection evals.',
  },
  variantsBody,
)

// --- Generate config.md ---

const configBody = [
  '## Configuration',
  '',
  renderSchemaSection({
    schema: DojoConfigSchema,
    description: 'Schema for the `dojo.toml` configuration file.',
  }),
].join('\n')

writePage(
  'config.md',
  {
    title: 'Config Reference',
    description: 'Reference for the dojo.toml configuration file format.',
  },
  configBody,
)

// --- Generate commands.md ---

interface CommandOption {
  flags: string
  description: string
  default?: string
}

interface CommandDef {
  name: string
  aliases?: string[]
  description: string
  usage: string
  arguments?: { name: string; description: string; required: boolean }[]
  options?: CommandOption[]
}

function renderCommandSection(cmd: CommandDef): string {
  const parts: string[] = []

  const aliasNote = cmd.aliases?.length ? ` (alias: \`${cmd.aliases.join('`, `')}\`)` : ''
  parts.push(`### \`dojo ${cmd.name}\`${aliasNote}`)
  parts.push('', cmd.description)
  parts.push('', '```', `dojo ${cmd.usage}`, '```')

  if (cmd.arguments?.length) {
    parts.push('', '#### Arguments', '')
    parts.push('| Argument | Description | Required |')
    parts.push('|----------|-------------|----------|')
    for (const arg of cmd.arguments) {
      parts.push(`| \`${arg.name}\` | ${arg.description} | ${arg.required ? 'Yes' : 'No'} |`)
    }
  }

  if (cmd.options?.length) {
    parts.push('', '#### Options', '')
    parts.push('| Flag | Description | Default |')
    parts.push('|------|-------------|---------|')
    for (const opt of cmd.options) {
      parts.push(`| \`${opt.flags}\` | ${opt.description} | ${opt.default ?? '-'} |`)
    }
  }

  return parts.join('\n')
}

const globalOptions: CommandOption[] = [
  { flags: '--skills-dir <dir>', description: 'Override skills directory (repeatable)' },
  { flags: '--evaluator-model <model>', description: 'Override evaluator model' },
  { flags: '--model-provider <provider>', description: 'Override model provider' },
  { flags: '--cwd <dir>', description: 'Working directory for config and skill discovery' },
  { flags: '-v, --version', description: 'Output the current version' },
  { flags: '-h, --help', description: 'Display help for command' },
]

const commands: CommandDef[] = [
  {
    name: 'run',
    description:
      'Run evals against discovered skills. Results are saved as JSON reports per-skill.',
    usage: 'run [skill] [options]',
    arguments: [
      {
        name: 'skill',
        description: 'Filter by skill name (supports glob patterns)',
        required: false,
      },
    ],
    options: [
      { flags: '-e, --eval <name>', description: 'Run only evals matching this name' },
      { flags: '-V, --variant <name>', description: 'Run only a specific variant (by name)' },
      {
        flags: '-p, --parallelism <n>',
        description: 'Max concurrent eval runs',
        default: 'CPU cores',
      },
      { flags: '--no-parallelism', description: 'Run evals sequentially' },
      { flags: '-o, --output <path>', description: 'Write combined report to file' },
      {
        flags: '-i, --inspect',
        description:
          'Show key session events (model, prompt, tool calls, errors). Full event stream is written to logs.json.',
      },
    ],
  },
  {
    name: 'list',
    aliases: ['ls'],
    description: 'List all discovered skills and evals in a tabular format.',
    usage: 'list [options]',
  },
  {
    name: 'validate',
    description: 'Validate the config, skills, and evals. Reports errors without running anything.',
    usage: 'validate [options]',
  },
]

const commandsBody = [
  '## Global Options',
  '',
  'These options are available on all commands.',
  '',
  '| Flag | Description | Default |',
  '|------|-------------|---------|',
  ...globalOptions.map(opt => `| \`${opt.flags}\` | ${opt.description} | ${opt.default ?? '-'} |`),
  '',
  '## Commands',
  '',
  ...commands.map(cmd => renderCommandSection(cmd)),
].join('\n')

writePage(
  'commands.md',
  {
    title: 'Commands Reference',
    description: 'Reference for all dojo CLI commands, arguments, and options.',
  },
  commandsBody,
)

console.log('Done.')
