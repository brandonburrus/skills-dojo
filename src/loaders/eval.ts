import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { EvalValidationError } from '../errors.js'
import { EvalSchema } from '../schemas/eval.js'
import type { DiscoveredEval, DiscoveredSkill } from '../types.js'

async function listYamlFiles(dir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
  return entries.filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).map(f => path.join(dir, f))
}

async function loadEvalsFromFile(
  filePath: string,
  skillName: string | null,
): Promise<DiscoveredEval[]> {
  const raw = await readFile(filePath, 'utf-8')

  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch (cause) {
    throw new EvalValidationError(
      `Invalid YAML in ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      filePath,
      { cause },
    )
  }

  if (parsed == null) return []

  const items = Array.isArray(parsed) ? (parsed as unknown[]) : [parsed]

  return items.map(item => {
    try {
      const eval_ = EvalSchema.parse(item)
      return { filePath, eval: eval_, skillName }
    } catch (cause) {
      throw new EvalValidationError(
        `Invalid eval in ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
        filePath,
        { cause },
      )
    }
  })
}

export async function discoverEvals(
  configDir: string,
  skills: readonly DiscoveredSkill[],
): Promise<DiscoveredEval[]> {
  const skillEvalDirs = skills.map(s => ({
    dir: path.join(s.dirPath, 'evals'),
    skillName: s.name as string | null,
  }))
  const rootDir = {
    dir: path.join(configDir, 'evals'),
    skillName: null as string | null,
  }
  const allDirs = [...skillEvalDirs, rootDir]

  const fileLists = await Promise.all(
    allDirs.map(async ({ dir, skillName }) => {
      const files = await listYamlFiles(dir)
      return files.map(f => ({ filePath: f, skillName }))
    }),
  )
  const allFiles = fileLists.flat()

  const results = await Promise.all(
    allFiles.map(({ filePath, skillName }) => loadEvalsFromFile(filePath, skillName)),
  )
  return results.flat()
}
