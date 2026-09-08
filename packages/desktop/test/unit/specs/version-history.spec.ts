import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import crypto from 'crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VersionSnapshot } from '@shared/types/ipc'

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'mt-vh-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Unit tests for the pure storage logic. We exercise VersionHistoryStore by
// driving its methods directly (no Electron IPC needed).
// ---------------------------------------------------------------------------

describe('VersionHistoryStore — snapshot lifecycle', () => {
  let store: {
    saveSnapshot: (s: VersionSnapshot) => Promise<VersionSnapshot | null>
    getSnapshots: (p: string) => VersionSnapshot[]
    getSnapshotContent: (p: string, id: string) => string | null
    deleteSnapshot: (p: string, id: string) => boolean
    clearHistory: (p: string) => boolean
  }

  let basePath: string

  beforeEach(async() => {
    basePath = tempDir()
    const { default: VersionHistoryStore } = await import('main_renderer/versionHistory')
    const instance = new VersionHistoryStore(basePath)

    store = {
      saveSnapshot: (s: VersionSnapshot) => instance.saveSnapshot(s),
      getSnapshots: (p: string) => instance.getSnapshots(p),
      getSnapshotContent: (p: string, id: string) => instance.getSnapshotContent(p, id),
      deleteSnapshot: (p: string, id: string) => instance.deleteSnapshot(p, id),
      clearHistory: (p: string) => instance.clearHistory(p)
    }
  })

  it('stores and retrieves a snapshot', async() => {
    const snap: VersionSnapshot = {
      id: 'test-1',
      pathname: '/foo/bar.md',
      timestamp: 1000,
      markdown: '# Hello',
      label: 'Manual Save',
      byteLength: 7
    }

    const saved = await store.saveSnapshot(snap)
    expect(saved).not.toBeNull()

    const list = store.getSnapshots('/foo/bar.md')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('test-1')
  })

  it('returns empty array for unknown file', () => {
    expect(store.getSnapshots('/nonexistent.md')).toEqual([])
  })

  it('deduplicates identical content', async() => {
    const snap1: VersionSnapshot = {
      id: 'a',
      pathname: '/doc.md',
      timestamp: 1000,
      markdown: 'same content',
      label: 'Manual Save',
      byteLength: 12
    }
    const snap2: VersionSnapshot = {
      id: 'b',
      pathname: '/doc.md',
      timestamp: 2000,
      markdown: 'same content',
      label: 'Auto-save',
      byteLength: 12
    }

    await store.saveSnapshot(snap1)
    const result = await store.saveSnapshot(snap2)

    expect(result).toBeNull()
    expect(store.getSnapshots('/doc.md')).toHaveLength(1)
  })

  it('keeps different content as separate snapshots', async() => {
    await store.saveSnapshot({
      id: 'a',
      pathname: '/doc.md',
      timestamp: 1000,
      markdown: 'version 1',
      label: 'Manual Save',
      byteLength: 9
    })
    await store.saveSnapshot({
      id: 'b',
      pathname: '/doc.md',
      timestamp: 2000,
      markdown: 'version 2',
      label: 'Auto-save',
      byteLength: 9
    })

    const list = store.getSnapshots('/doc.md')
    expect(list).toHaveLength(2)
    expect(list.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('retrieves content by snapshot id', async() => {
    await store.saveSnapshot({
      id: 'snap-x',
      pathname: '/doc.md',
      timestamp: 1000,
      markdown: 'retrievable content',
      label: 'Idle',
      byteLength: 18
    })

    expect(store.getSnapshotContent('/doc.md', 'snap-x')).toBe('retrievable content')
    expect(store.getSnapshotContent('/doc.md', 'nonexistent')).toBeNull()
  })

  it('deletes a specific snapshot', async() => {
    await store.saveSnapshot({
      id: 'keep',
      pathname: '/doc.md',
      timestamp: 1000,
      markdown: 'keep me',
      label: 'Manual Save',
      byteLength: 7
    })
    await store.saveSnapshot({
      id: 'remove',
      pathname: '/doc.md',
      timestamp: 2000,
      markdown: 'remove me',
      label: 'Auto-save',
      byteLength: 9
    })

    const deleted = store.deleteSnapshot('/doc.md', 'remove')
    expect(deleted).toBe(true)

    const list = store.getSnapshots('/doc.md')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('keep')
  })

  it('returns false when deleting non-existent snapshot', () => {
    expect(store.deleteSnapshot('/doc.md', 'nope')).toBe(false)
  })

  it('clears all history for a file', async() => {
    await store.saveSnapshot({
      id: 'a',
      pathname: '/doc.md',
      timestamp: 1000,
      markdown: 'content',
      label: 'Manual Save',
      byteLength: 7
    })

    const cleared = store.clearHistory('/doc.md')
    expect(cleared).toBe(true)
    expect(store.getSnapshots('/doc.md')).toEqual([])
  })

  it('returns false when clearing non-existent history', () => {
    expect(store.clearHistory('/never-existed.md')).toBe(false)
  })

  it('isolates histories by pathname', async() => {
    await store.saveSnapshot({
      id: 'a',
      pathname: '/file-a.md',
      timestamp: 1000,
      markdown: 'content a',
      label: 'Manual Save',
      byteLength: 9
    })
    await store.saveSnapshot({
      id: 'b',
      pathname: '/file-b.md',
      timestamp: 1000,
      markdown: 'content b',
      label: 'Manual Save',
      byteLength: 9
    })

    expect(store.getSnapshots('/file-a.md')).toHaveLength(1)
    expect(store.getSnapshots('/file-b.md')).toHaveLength(1)
    expect(store.getSnapshots('/file-a.md')[0].markdown).toBe('content a')
    expect(store.getSnapshots('/file-b.md')[0].markdown).toBe('content b')
  })

  it('caps snapshots at MAX_SNAPSHOTS_PER_FILE (FIFO eviction)', async() => {
    // Insert 52 snapshots (cap is 50).
    for (let i = 0; i < 52; i++) {
      await store.saveSnapshot({
        id: `snap-${i}`,
        pathname: '/big.md',
        timestamp: i,
        markdown: `content-${i}`,
        label: 'Idle',
        byteLength: 9
      })
    }

    const list = store.getSnapshots('/big.md')
    expect(list).toHaveLength(50)
    // Oldest two should be evicted.
    expect(list[0].id).toBe('snap-2')
    expect(list[49].id).toBe('snap-51')
  })

  it('persists snapshots to disk (survives instance recreation)', async() => {
    const { default: VersionHistoryStore } = await import('main_renderer/versionHistory')

    // First instance writes.
    const instance1 = new VersionHistoryStore(basePath)
    await instance1.saveSnapshot({
      id: 'persisted',
      pathname: '/persist.md',
      timestamp: 42,
      markdown: 'durable',
      label: 'Manual Save',
      byteLength: 7
    })

    // Second instance reads from same directory.
    const instance2 = new VersionHistoryStore(basePath)
    const list = instance2.getSnapshots('/persist.md')
    expect(list).toHaveLength(1)
    expect(list[0].markdown).toBe('durable')
  })

  it('writes a valid JSON file on disk', async() => {
    const { default: VersionHistoryStore } = await import('main_renderer/versionHistory')
    const instance = new VersionHistoryStore(basePath)

    await instance.saveSnapshot({
      id: 'json-test',
      pathname: '/json-test.md',
      timestamp: 1000,
      markdown: 'json content',
      label: 'Manual Save',
      byteLength: 12
    })

    // Find the file in the basePath directory.
    const files = readdirSync(basePath)
    expect(files).toHaveLength(1)

    const raw = readFileSync(path.join(basePath, files[0]), 'utf8')
    const parsed = JSON.parse(raw) as { pathname: string; snapshots: VersionSnapshot[] }
    expect(parsed.pathname).toBe('/json-test.md')
    expect(parsed.snapshots).toHaveLength(1)
    expect(parsed.snapshots[0].id).toBe('json-test')
  })

  it('recovers gracefully from corrupted disk file', async() => {
    const { default: VersionHistoryStore } = await import('main_renderer/versionHistory')
    const instance = new VersionHistoryStore(basePath)

    // Write a corrupted JSON file directly.
    const hash = crypto.createHash('sha1').update('/corrupt.md').digest('hex')
    const fs = await import('fs')
    fs.writeFileSync(path.join(basePath, `${hash}.json`), '{ invalid json')

    // Should return empty array, not throw.
    const list = instance.getSnapshots('/corrupt.md')
    expect(list).toEqual([])
  })
})
