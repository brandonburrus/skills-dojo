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
  skillsDir?: string[]
}

const CONFIG_FILENAME = 'dojo.toml'

export async function loadConfig(
  startDir?: string,
  overrides?: ConfigOverrides,
): Promise<{
  config: DojoConfig
  configDir: string
}> {
  const dir = startDir ?? process.cwd()
  const configPath = path.join(dir, CONFIG_FILENAME)

  let raw: string
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { config: applyOverrides(DEFAULT_CONFIG, overrides), configDir: dir }
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

  try {
    const config = applyOverrides(DojoConfigSchema.parse(parsed), overrides)
    return { config, configDir: dir }
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

function applyOverrides(config: DojoConfig, overrides?: ConfigOverrides): DojoConfig {
  if (!overrides) return config

  return {
    ...config,
    skills: overrides.skillsDir ? { ...config.skills, dir: overrides.skillsDir } : config.skills,
    model: {
      ...config.model,
      ...(overrides.modelProvider && { provider: overrides.modelProvider }),
      ...(overrides.evaluatorModel && { evaluator: overrides.evaluatorModel }),
    },
  }
}
