import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSettingsState = {
  knowledge: { autoIndexEnabled: true },
}

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => mockSettingsState },
}))
vi.mock('@/services/ai/aiClient', () => ({ isEmbeddingReady: () => false }))
vi.mock('@/hooks/useTauri', () => ({ readFile: vi.fn(), joinPath: vi.fn() }))
vi.mock('@/services/fileSystem', () => ({ listDirectory: vi.fn() }))
vi.mock('@/services/fileTree', () => ({ shouldSkipWorkspaceDirectory: vi.fn() }))
vi.mock('@/services/rag/pipeline', () => ({
  ingestDocument: vi.fn(),
  processEmbeddingQueue: vi.fn(),
  runSerializedDocumentOperation: vi.fn(),
}))
vi.mock('@/services/rag/vectorStore', () => ({
  vectorStore: { replaceDocument: vi.fn(), flushPersistence: vi.fn() },
}))
vi.mock('@/services/rag/nativeIndex', () => ({ refreshNativeRagIndexDocument: vi.fn() }))

import {
  cancelPendingIndexTimers,
  getPendingIndexTimerPaths,
  scheduleMarkdownDocumentIndex,
} from '@/services/rag/indexer'

describe('automatic Markdown indexing schedule', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    cancelPendingIndexTimers(getPendingIndexTimerPaths())
  })

  afterEach(() => {
    cancelPendingIndexTimers(getPendingIndexTimerPaths())
    vi.useRealTimers()
  })

  it('does not schedule synchronous automatic indexing for huge documents', () => {
    expect(scheduleMarkdownDocumentIndex('D:/anonymous/huge.md', 'huge', 'x'.repeat(100_000))).toBe(false)
    expect(getPendingIndexTimerPaths()).toEqual([])
  })

  it('cancels a pending small-document index when the document becomes huge', () => {
    const path = 'D:/anonymous/growing.md'
    expect(scheduleMarkdownDocumentIndex(path, 'growing', 'small')).toBe(true)
    expect(getPendingIndexTimerPaths()).toEqual([path])

    expect(scheduleMarkdownDocumentIndex(path, 'growing', 'x'.repeat(100_000))).toBe(false)
    expect(getPendingIndexTimerPaths()).toEqual([])
  })
})
