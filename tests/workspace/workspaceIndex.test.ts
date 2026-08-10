import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fileExists: vi.fn(),
  listDirectory: vi.fn(),
  listEmbeddingJobs: vi.fn(),
  loadDocumentFilePaths: vi.fn(),
  removeEmbeddingJobByPath: vi.fn(),
  removePersistedDocumentByPath: vi.fn(),
  indexWorkspaceMarkdown: vi.fn(),
  vectorRemove: vi.fn(),
  removeNative: vi.fn(),
}))

vi.mock('@/hooks/useTauri', () => ({ fileExists: mocks.fileExists }))
vi.mock('@/services/fileSystem', () => ({ listDirectory: mocks.listDirectory }))
vi.mock('@/services/database/persistence', () => ({
  listEmbeddingJobs: mocks.listEmbeddingJobs,
  loadDocumentFilePaths: mocks.loadDocumentFilePaths,
  removeEmbeddingJobByPath: mocks.removeEmbeddingJobByPath,
  removePersistedDocumentByPath: mocks.removePersistedDocumentByPath,
}))
vi.mock('@/services/rag/indexer', () => ({ indexWorkspaceMarkdown: mocks.indexWorkspaceMarkdown }))
vi.mock('@/services/rag/vectorStore', () => ({ vectorStore: { removeByFilePath: mocks.vectorRemove } }))
vi.mock('@/services/rag/nativeIndex', () => ({ removeNativeRagIndexDocument: mocks.removeNative }))

import { cleanupMissingWorkspaceDocuments, rebuildWorkspaceDocuments } from '@/services/workspaceIndex'

describe('multi-root workspace index maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listEmbeddingJobs.mockResolvedValue([])
    mocks.listDirectory.mockResolvedValue([])
    mocks.fileExists.mockResolvedValue(false)
    mocks.indexWorkspaceMarkdown.mockResolvedValue({ indexed: 1, skipped: 0, failed: 0, errors: [] })
  })

  it('cleans only documents inside the selected root boundary', async () => {
    mocks.loadDocumentFilePaths.mockResolvedValue([
      'D:/Notes/a.md',
      'D:/Notes2/b.md',
      'E:/Study/c.md',
    ])

    const result = await cleanupMissingWorkspaceDocuments('d:\\notes\\')

    expect(result.removedPaths).toEqual(['D:/Notes/a.md'])
    expect(mocks.removePersistedDocumentByPath).toHaveBeenCalledTimes(1)
  })

  it('does not delete indexes when a configured root is unavailable', async () => {
    mocks.listDirectory.mockRejectedValue(new Error('目录不存在'))
    mocks.loadDocumentFilePaths.mockResolvedValue(['D:/Missing/a.md'])

    const result = await cleanupMissingWorkspaceDocuments('D:/Missing')

    expect(result.removed).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(mocks.removePersistedDocumentByPath).not.toHaveBeenCalled()
  })

  it('rebuilds readable roots while preserving indexes under failed roots', async () => {
    mocks.listDirectory.mockImplementation(async (path: string) => {
      if (path === 'D:/Missing') throw new Error('目录不存在')
      return []
    })
    mocks.loadDocumentFilePaths.mockResolvedValue(['D:/Missing/a.md', 'E:/Study/b.md'])

    const result = await rebuildWorkspaceDocuments(['D:/Missing', 'E:/Study'])

    expect(result.removedPaths).toEqual(['E:/Study/b.md'])
    expect(result.errors[0]).toContain('D:/Missing')
    expect(mocks.indexWorkspaceMarkdown).toHaveBeenCalledTimes(1)
    expect(mocks.indexWorkspaceMarkdown).toHaveBeenCalledWith('E:/Study')
  })
})
