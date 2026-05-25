import { readFile, access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { EvalValidationError } from '../errors.js'
import { EffectivenessFileSchema, SelectionFileSchema } from '../schemas/eval.js'
import type {
  DiscoveredEffectivenessFile,
  DiscoveredFixture,
  DiscoveredSelectionFile,
  DiscoveredSkill,
} from '../types.js'

const SELECTION_FILENAMES = ['selection.yaml', 'selection.yml'] as const

async function findSelectionFile(evalsDir: string): Promise<string | null> {
  for (const name of SELECTION_FILENAMES) {
    const filePath = path.join(evalsDir, name)
    try {
      await access(filePath)
      return filePath
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
  }
  return null
}

async function loadSelectionFile(
  filePath: string,
  skillName: string | null,
): Promise<DiscoveredSelectionFile> {
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

  try {
    const file = SelectionFileSchema.parse(parsed)
    return { filePath, skillName, file }
  } catch (cause) {
    throw new EvalValidationError(
      `Invalid selection file ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      filePath,
      { cause },
    )
  }
}

export async function discoverSelectionFiles(
  configDir: string,
  skills: readonly DiscoveredSkill[],
): Promise<DiscoveredSelectionFile[]> {
  const candidates: Array<{ evalsDir: string; skillName: string | null }> = [
    ...skills.map(s => ({
      evalsDir: path.join(s.dirPath, 'evals'),
      skillName: s.name,
    })),
    { evalsDir: path.join(configDir, 'evals'), skillName: null },
  ]

  const found = await Promise.all(
    candidates.map(async ({ evalsDir, skillName }) => {
      const filePath = await findSelectionFile(evalsDir)
      if (!filePath) return null
      return loadSelectionFile(filePath, skillName)
    }),
  )

  return found.filter((r): r is DiscoveredSelectionFile => r !== null)
}

const EFFECTIVENESS_FILENAMES = ['effectiveness.yaml', 'effectiveness.yml'] as const

async function findEffectivenessFile(evalsDir: string): Promise<string | null> {
  for (const name of EFFECTIVENESS_FILENAMES) {
    const filePath = path.join(evalsDir, name)
    try {
      await access(filePath)
      return filePath
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
  }
  return null
}

async function loadEffectivenessFile(
  filePath: string,
  skillName: string | null,
): Promise<DiscoveredEffectivenessFile> {
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

  try {
    const file = EffectivenessFileSchema.parse(parsed)
    return { filePath, skillName, file }
  } catch (cause) {
    throw new EvalValidationError(
      `Invalid effectiveness file ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      filePath,
      { cause },
    )
  }
}

export async function discoverEffectivenessFiles(
  configDir: string,
  skills: readonly DiscoveredSkill[],
): Promise<DiscoveredEffectivenessFile[]> {
  const candidates: Array<{ evalsDir: string; skillName: string | null }> = [
    ...skills.map(s => ({
      evalsDir: path.join(s.dirPath, 'evals'),
      skillName: s.name,
    })),
    { evalsDir: path.join(configDir, 'evals'), skillName: null },
  ]

  const found = await Promise.all(
    candidates.map(async ({ evalsDir, skillName }) => {
      const filePath = await findEffectivenessFile(evalsDir)
      if (!filePath) return null
      return loadEffectivenessFile(filePath, skillName)
    }),
  )

  return found.filter((r): r is DiscoveredEffectivenessFile => r !== null)
}

export async function discoverFixtures(evalsDir: string): Promise<DiscoveredFixture[]> {
  const fixturesDir = path.join(evalsDir, 'fixtures')

  try {
    await access(fixturesDir)
  } catch {
    return []
  }

  const entries = await readdir(fixturesDir, { withFileTypes: true })
  const fixtures: DiscoveredFixture[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const fixtureDir = path.join(fixturesDir, entry.name)
    const testsDir = path.join(fixtureDir, 'tests')

    try {
      await access(testsDir)
    } catch {
      console.warn(`Fixture "${entry.name}" skipped: missing tests/ directory in ${fixtureDir}`)
      continue
    }

    const goldenDir = path.join(fixtureDir, 'golden')
    let hasGolden = false
    try {
      await access(goldenDir)
      hasGolden = true
    } catch {
      // golden dir is optional
    }

    fixtures.push({
      name: entry.name,
      testsDir,
      ...(hasGolden ? { goldenDir } : {}),
    })
  }

  return fixtures
}
