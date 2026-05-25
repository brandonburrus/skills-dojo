import { describe, expect, it } from 'vitest'
import { computeFsDiff, type FileSnapshot } from '../../../src/runner/sandbox/fs-diff.js'

describe('computeFsDiff', () => {
  it('returns empty diff when no changes', () => {
    const snapshot: FileSnapshot[] = [{ path: 'file.ts', content: 'hello', size: 5, mtime: 1000 }]
    const result = computeFsDiff(snapshot, snapshot)
    expect(result).toEqual([])
  })

  it('detects new file added', () => {
    const before: FileSnapshot[] = []
    const after: FileSnapshot[] = [
      { path: 'new.ts', content: 'new content', size: 11, mtime: 2000 },
    ]
    const result = computeFsDiff(before, after)
    expect(result).toEqual([{ path: 'new.ts', type: 'added', content: 'new content' }])
  })

  it('detects file deleted', () => {
    const before: FileSnapshot[] = [
      { path: 'old.ts', content: 'old content', size: 11, mtime: 1000 },
    ]
    const after: FileSnapshot[] = []
    const result = computeFsDiff(before, after)
    expect(result).toEqual([{ path: 'old.ts', type: 'deleted' }])
  })

  it('detects file modified', () => {
    const before: FileSnapshot[] = [{ path: 'file.ts', content: 'original', size: 8, mtime: 1000 }]
    const after: FileSnapshot[] = [{ path: 'file.ts', content: 'updated', size: 7, mtime: 2000 }]
    const result = computeFsDiff(before, after)
    expect(result).toEqual([{ path: 'file.ts', type: 'modified', content: 'updated' }])
  })

  it('detects large file modified via size/mtime', () => {
    const before: FileSnapshot[] = [{ path: 'big.bin', content: '', size: 200000, mtime: 1000 }]
    const after: FileSnapshot[] = [{ path: 'big.bin', content: '', size: 210000, mtime: 2000 }]
    const result = computeFsDiff(before, after)
    expect(result).toEqual([{ path: 'big.bin', type: 'modified', content: '' }])
  })

  it('does not flag large file as modified when size and mtime match', () => {
    const before: FileSnapshot[] = [{ path: 'big.bin', content: '', size: 200000, mtime: 1000 }]
    const after: FileSnapshot[] = [{ path: 'big.bin', content: '', size: 200000, mtime: 1000 }]
    const result = computeFsDiff(before, after)
    expect(result).toEqual([])
  })

  it('handles multiple changes at once', () => {
    const before: FileSnapshot[] = [
      { path: 'keep.ts', content: 'same', size: 4, mtime: 1000 },
      { path: 'modify.ts', content: 'old', size: 3, mtime: 1000 },
      { path: 'delete.ts', content: 'gone', size: 4, mtime: 1000 },
    ]
    const after: FileSnapshot[] = [
      { path: 'keep.ts', content: 'same', size: 4, mtime: 1000 },
      { path: 'modify.ts', content: 'new', size: 3, mtime: 2000 },
      { path: 'added.ts', content: 'fresh', size: 5, mtime: 2000 },
    ]
    const result = computeFsDiff(before, after)
    expect(result).toHaveLength(3)
    expect(result).toContainEqual({ path: 'modify.ts', type: 'modified', content: 'new' })
    expect(result).toContainEqual({ path: 'added.ts', type: 'added', content: 'fresh' })
    expect(result).toContainEqual({ path: 'delete.ts', type: 'deleted' })
  })

  it('does not include unchanged files', () => {
    const before: FileSnapshot[] = [
      { path: 'a.ts', content: 'same', size: 4, mtime: 1000 },
      { path: 'b.ts', content: 'same', size: 4, mtime: 1000 },
    ]
    const after: FileSnapshot[] = [
      { path: 'a.ts', content: 'same', size: 4, mtime: 1000 },
      { path: 'b.ts', content: 'same', size: 4, mtime: 1000 },
    ]
    const result = computeFsDiff(before, after)
    expect(result).toEqual([])
  })
})
