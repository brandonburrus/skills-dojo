import { mkdir, cp, rm, access, chmod } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import type { FileDiff } from '../../providers/types.js'
import { snapshotDir, computeFsDiff, type FileSnapshot } from './fs-diff.js'

const execFileAsync = promisify(execFile)

export interface SandboxOptions {
  runId: string
  skillName: string
  fixtureName: string
  skillDirPath: string
  fixtureTestsDir: string
  evaluatorId: string
  sample: number
}

export interface Sandbox {
  workspaceDir: string
  skillDir: string
  baseDir: string
  beforeSnapshot: FileSnapshot[]
}

export interface SandboxResult {
  fsDiff: FileDiff[]
}

/** Create and populate a sandbox. */
export async function createSandbox(options: SandboxOptions): Promise<Sandbox> {
  const baseDir = path.join(
    os.tmpdir(),
    `dojo-${options.runId}`,
    options.skillName,
    options.fixtureName,
    options.evaluatorId,
    String(options.sample),
  )

  const workspaceDir = path.join(baseDir, 'workspace')
  const skillDir = path.join(baseDir, '.dojo-skill')

  await mkdir(workspaceDir, { recursive: true })
  await mkdir(skillDir, { recursive: true })

  await cp(options.fixtureTestsDir, workspaceDir, { recursive: true })
  await cp(options.skillDirPath, skillDir, { recursive: true })

  const beforeSnapshot = await snapshotDir(workspaceDir)

  return { workspaceDir, skillDir, baseDir, beforeSnapshot }
}

/** Run setup.sh if it exists in the workspace. */
export async function runSetup(sandbox: Sandbox, signal?: AbortSignal): Promise<void> {
  const setupPath = path.join(sandbox.workspaceDir, 'setup.sh')

  try {
    await access(setupPath)
  } catch {
    return
  }

  await chmod(setupPath, 0o755)

  const { stdout, stderr } = await execFileAsync('bash', ['setup.sh'], {
    cwd: sandbox.workspaceDir,
    signal,
  }).catch((error: unknown) => {
    const execError = error as { stdout?: string; stderr?: string; message?: string }
    throw new Error(`setup.sh failed:\n${execError.stdout ?? ''}\n${execError.stderr ?? ''}`.trim())
  })

  // Avoid unused variable warnings
  void stdout
  void stderr

  sandbox.beforeSnapshot = await snapshotDir(sandbox.workspaceDir)
}

/** Compute the fs diff after the agent has run. */
export async function finalizeSandbox(sandbox: Sandbox): Promise<SandboxResult> {
  const afterSnapshot = await snapshotDir(sandbox.workspaceDir)
  const fsDiff = computeFsDiff(sandbox.beforeSnapshot, afterSnapshot)
  return { fsDiff }
}

/** Remove the sandbox temp directory. */
export async function cleanupSandbox(sandbox: Sandbox): Promise<void> {
  await rm(sandbox.baseDir, { recursive: true, force: true })
}
