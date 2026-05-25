import { describe, expect, it } from 'vitest'
import { computeFsDiff, type FileSnapshot } from '../../../src/runner/sandbox/fs-diff.js'

describe('computeFsDiff', () => {
  it('returns empty diff when no changes', () => {
    const snapshot: FileSnapshot[] = [{ path: 'file.ts', content: 'hello', mtime: 1000 }]
    const result = computeFsDiff(snapshot, snapshot)
    expect(result).toEqual([])
  })

  it('detects new file added', () => {
    const before: FileSnapshot[] = []
    const after: FileSnapshot[] = [{ path: 'new.ts', content: 'new content', mtime: 2000 }]
    const result = computeFsDiff(before, after)
    expect(result).toEqual([{ path: 'new.ts', type: 'added', content: 'new content' }])
  })

  it('detects file deleted', () => {
    const before: FileSnapshot[] = [{ path: 'old.ts', content: 'old content', mtime: 1000 }]
    const after: FileSnapshot[] = []
    const result = computeFsDiff(before, after)
    expect(result).toEqual([{ path: 'old.ts', type: 'deleted' }])
  })

  it('detects file modified', () => {
    const before: FileSnapshot[] = [{ path: 'file.ts', content: 'original', mtime: 1000 }]
    const after: FileSnapshot[] = [{ path: 'file.ts', content: 'updated', mtime: 2000 }]
    const result = computeFsDiff(before, after)
    expect(result).toEqual([{ path: 'file.ts', type: 'modified', content: 'updated' }])
  })

  it('handles multiple changes at once', () => {
    const before: FileSnapshot[] = [
      { path: 'keep.ts', content: 'same', mtime: 1000 },
      { path: 'modify.ts', content: 'old', mtime: 1000 },
      { path: 'delete.ts', content: 'gone', mtime: 1000 },
    ]
    const after: FileSnapshot[] = [
      { path: 'keep.ts', content: 'same', mtime: 1000 },
      { path: 'modify.ts', content: 'new', mtime: 2000 },
      { path: 'added.ts', content: 'fresh', mtime: 2000 },
    ]
    const result = computeFsDiff(before, after)
    expect(result).toHaveLength(3)
    expect(result).toContainEqual({ path: 'modify.ts', type: 'modified', content: 'new' })
    expect(result).toContainEqual({ path: 'added.ts', type: 'added', content: 'fresh' })
    expect(result).toContainEqual({ path: 'delete.ts', type: 'deleted' })
  })

  it('does not include unchanged files', () => {
    const before: FileSnapshot[] = [
      { path: 'a.ts', content: 'same', mtime: 1000 },
      { path: 'b.ts', content: 'same', mtime: 1000 },
    ]
    const after: FileSnapshot[] = [
      { path: 'a.ts', content: 'same', mtime: 1000 },
      { path: 'b.ts', content: 'same', mtime: 1000 },
    ]
    const result = computeFsDiff(before, after)
    expect(result).toEqual([])
  })
})
