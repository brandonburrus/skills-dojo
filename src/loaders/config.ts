import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { z } from 'zod/v4'
import { ConfigValidationError } from '../errors.js'
import { DEFAULT_CONFIG, DojoConfigSchema } from '../schemas/config.js'
import type { DojoConfig } from '../types.js'

export interface ConfigOverrides {
  modelProvider?: string
  evaluatorModel?: string
  judgeModel?: string
  skillsDir?: string[]
}

const CONFIG_FILENAME = 'dojo.toml'

export type ConfigSource = 'file' | 'defaults'

export interface LoadConfigResult {
  config: DojoConfig
  configDir: string
  source: ConfigSource
}

export async function loadConfig(
  startDir?: string,
  overrides?: ConfigOverrides,
  configFile?: string,
): Promise<LoadConfigResult> {
  const dir = startDir ?? process.cwd()
  const configPath = configFile ?? path.join(dir, CONFIG_FILENAME)
  const configDir = configFile ? path.dirname(path.resolve(configFile)) : dir

  let raw: string
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {
        config: parseConfig(applyOverrides(DEFAULT_CONFIG, overrides), configPath),
        configDir,
        source: 'defaults',
      }
    }
    throw new ConfigValidationError(
      `Failed to read ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      [{ path: '', message: error instanceof Error ? error.message : String(error) }],
      { cause: error },
    )
  }

  let parsed: unknown
  try {
    parsed = parseToml(raw)
  } catch (cause) {
    throw new ConfigValidationError(
      `Invalid TOML in ${configPath}`,
      [{ path: '', message: cause instanceof Error ? cause.message : String(cause) }],
      { cause },
    )
  }

  const fileConfig = parseConfig(parsed, configPath)
  const merged = applyOverrides(fileConfig, overrides)
  // Re-parse after CLI overrides so flag-injected values (e.g. --model-provider)
  // are validated by the same schema as values from the TOML file.
  const config = parseConfig(merged, configPath)
  return { config, configDir, source: 'file' }
}

function parseConfig(input: unknown, configPath: string): DojoConfig {
  try {
    return DojoConfigSchema.parse(input)
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      const issues = cause.issues.map(issue => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      }))
      throw new ConfigValidationError(`Invalid config in ${configPath}`, issues, { cause })
    }
    throw cause
  }
}

// Returns `unknown` because CLI overrides may inject values that fail the schema
// (e.g. an unknown provider string). The caller is expected to feed the result
// back into `parseConfig` for validation.
function applyOverrides(config: DojoConfig, overrides?: ConfigOverrides): unknown {
  if (!overrides) return config

  return {
    ...config,
    skills: overrides.skillsDir ? { ...config.skills, dir: overrides.skillsDir } : config.skills,
    model: {
      ...config.model,
      ...(overrides.modelProvider && { provider: overrides.modelProvider }),
      ...(overrides.evaluatorModel && { evaluator: overrides.evaluatorModel }),
      ...(overrides.judgeModel && { judge: overrides.judgeModel }),
    },
  }
}
