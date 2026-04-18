import { readFile, readdir, access } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { EvalValidationError } from '../errors.js'
import { VariantSchema } from '../schemas/variant.js'
import type { DiscoveredSkill, DiscoveredVariant, Variant } from '../types.js'

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

function parseVariantsFromFile(filePath: string, parsed: unknown): Variant[] {
  const items = Array.isArray(parsed) ? (parsed as unknown[]) : [parsed]

  return items.map(item => {
    try {
      return VariantSchema.parse(item)
    } catch (cause) {
      throw new EvalValidationError(
        `Invalid variant in ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
        filePath,
        { cause },
      )
    }
  })
}

async function loadVariantsFromFile(
  filePath: string,
  skillName: string,
): Promise<DiscoveredVariant | null> {
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

  if (parsed == null) return null

  const variants = parseVariantsFromFile(filePath, parsed)
  return { filePath, skillName, variants }
}

async function findSingleVariantFile(evalsDir: string): Promise<string | null> {
  for (const name of ['variants.yaml', 'variants.yml']) {
    const filePath = path.join(evalsDir, name)
    try {
      await access(filePath)
      return filePath
    } catch {}
  }
  return null
}

export async function discoverVariants(
  skills: readonly DiscoveredSkill[],
): Promise<DiscoveredVariant[]> {
  const fileLists = await Promise.all(
    skills.map(async s => {
      const evalsDir = path.join(s.dirPath, 'evals')
      const files: Array<{ filePath: string; skillName: string }> = []

      // evals/variants.yaml (single file)
      const singleFile = await findSingleVariantFile(evalsDir)
      if (singleFile) {
        files.push({ filePath: singleFile, skillName: s.name })
      }

      // evals/variants/*.yaml (directory)
      const dirFiles = await listYamlFiles(path.join(evalsDir, 'variants'))
      for (const f of dirFiles) {
        files.push({ filePath: f, skillName: s.name })
      }

      return files
    }),
  )
  const allFiles = fileLists.flat()

  const results = await Promise.all(
    allFiles.map(({ filePath, skillName }) => loadVariantsFromFile(filePath, skillName)),
  )

  return results.filter((r): r is DiscoveredVariant => r !== null)
}
