import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FileDiff } from '../../providers/types.js'

export interface FileSnapshot {
  path: string
  content: string
  size: number
  mtime: number
}

const SKIP_DIRS = new Set(['.git', 'node_modules'])
const SKIP_FILES = new Set(['.dojo-artifact.json'])
const MAX_BINARY_SIZE = 100 * 1024
const MAX_SNAPSHOT_FILES = 1000
const MAX_TOTAL_BYTES = 10 * 1024 * 1024 // 10MB

interface WalkContext {
  fileCount: number
  totalBytes: number
}

/** Recursively snapshot all files in a directory (relative paths). */
export async function snapshotDir(dir: string): Promise<FileSnapshot[]> {
  const snapshots: FileSnapshot[] = []
  await walk(dir, dir, snapshots, { fileCount: 0, totalBytes: 0 })
  return snapshots
}

async function walk(
  baseDir: string,
  currentDir: string,
  snapshots: FileSnapshot[],
  ctx: WalkContext,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true })

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    if (ctx.fileCount >= MAX_SNAPSHOT_FILES) return

    const fullPath = path.join(currentDir, entry.name)

    if (entry.isDirectory()) {
      await walk(baseDir, fullPath, snapshots, ctx)
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) continue
      const fileStat = await stat(fullPath)
      const relativePath = path.relative(baseDir, fullPath)

      let content = ''
      if (fileStat.size <= MAX_BINARY_SIZE && ctx.totalBytes + fileStat.size <= MAX_TOTAL_BYTES) {
        content = await readFile(fullPath, 'utf-8')
        ctx.totalBytes += fileStat.size
      }

      snapshots.push({
        path: relativePath,
        content,
        size: fileStat.size,
        mtime: fileStat.mtimeMs,
      })
      ctx.fileCount++
    }
  }
}

/** Compute the diff between before and after snapshots. */
export function computeFsDiff(before: FileSnapshot[], after: FileSnapshot[]): FileDiff[] {
  const beforeMap = new Map(before.map(f => [f.path, f]))
  const afterMap = new Map(after.map(f => [f.path, f]))
  const diffs: FileDiff[] = []

  for (const [filePath, snapshot] of afterMap) {
    const beforeFile = beforeMap.get(filePath)
    if (!beforeFile) {
      diffs.push({ path: filePath, type: 'added', content: snapshot.content })
    } else if (beforeFile.content !== snapshot.content) {
      diffs.push({ path: filePath, type: 'modified', content: snapshot.content })
    } else if (
      beforeFile.content === '' &&
      (beforeFile.size !== snapshot.size || beforeFile.mtime !== snapshot.mtime)
    ) {
      diffs.push({ path: filePath, type: 'modified', content: '' })
    }
  }

  for (const filePath of beforeMap.keys()) {
    if (!afterMap.has(filePath)) {
      diffs.push({ path: filePath, type: 'deleted' })
    }
  }

  return diffs
}
