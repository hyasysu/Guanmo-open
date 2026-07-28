import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  mockIndexMarkdownDocumentAsync,
  mockCancelPendingIndexTimers,
  mockRunSerializedDocumentOperation,
  mockRemovePersistedDocumentByPathTransaction,
  mockRemoveNativeRagIndexDocument,
  mockGetKnowledgeDocumentStates,
  mockLoadDocumentIndexMetadata,
  mockGetEmbeddingConfig,
  mockVectorStoreRemoveByFilePathFromMemory,
} = vi.hoisted(() => ({
  mockIndexMarkdownDocumentAsync: vi.fn(),
  mockCancelPendingIndexTimers: vi.fn(),
  mockRunSerializedDocumentOperation: vi.fn(),
  mockRemovePersistedDocumentByPathTransaction: vi.fn(),
  mockRemoveNativeRagIndexDocument: vi.fn(),
  mockGetKnowledgeDocumentStates: vi.fn(),
  mockLoadDocumentIndexMetadata: vi.fn(),
  mockGetEmbeddingConfig: vi.fn(),
  mockVectorStoreRemoveByFilePathFromMemory: vi.fn(),
}))

vi.mock('@/services/rag/indexer', () => ({
  indexMarkdownDocumentAsync: mockIndexMarkdownDocumentAsync,
  cancelPendingIndexTimers: mockCancelPendingIndexTimers,
  isMarkdownPath: (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase() || ''
    return ['md', 'markdown', 'mdx'].includes(ext)
  },
}))

vi.mock('@/services/rag/pipeline', () => ({
  getKnowledgeDocumentStates: mockGetKnowledgeDocumentStates,
  runSerializedDocumentOperation: mockRunSerializedDocumentOperation,
}))

vi.mock('@/services/database/persistence', () => ({
  loadDocumentIndexMetadata: mockLoadDocumentIndexMetadata,
  removePersistedDocumentByPathTransaction: mockRemovePersistedDocumentByPathTransaction,
}))

vi.mock('@/services/rag/vectorStore', () => ({
  vectorStore: {
    removeByFilePathFromMemory: mockVectorStoreRemoveByFilePathFromMemory,
  },
}))

vi.mock('@/services/rag/nativeIndex', () => ({
  removeNativeRagIndexDocument: mockRemoveNativeRagIndexDocument,
}))

vi.mock('@/services/ai/aiClient', () => ({
  getEmbeddingConfig: mockGetEmbeddingConfig,
}))

vi.mock('@/services/rag/embeddingInput', () => ({
  EMBEDDING_PREPROCESS_VERSION: 'v1',
}))

import {
  addKnowledgeDocument,
  isKnowledgeDocumentIndexed,
  removeKnowledgeDocuments,
  listKnowledgeDocuments,
} from '@/services/rag/knowledgeBase'

describe('addKnowledgeDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('拒绝非 Markdown 文件', async () => {
    const result = await addKnowledgeDocument({
      filePath: 'test.txt',
      title: 'test',
      content: 'hello',
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('非 Markdown 文件或路径为空')
    expect(mockIndexMarkdownDocumentAsync).not.toHaveBeenCalled()
  })

  it('拒绝空路径', async () => {
    const result = await addKnowledgeDocument({
      filePath: '',
      title: 'test',
      content: 'hello',
    })
    expect(result.success).toBe(false)
  })

  it('手动入库调用显式索引 API 并等待完成', async () => {
    mockIndexMarkdownDocumentAsync.mockResolvedValue(true)
    const result = await addKnowledgeDocument({
      filePath: 'test.md',
      title: 'test',
      content: '# hello',
    })
    expect(result.success).toBe(true)
    expect(result.filePath).toBe('test.md')
    expect(mockIndexMarkdownDocumentAsync).toHaveBeenCalledWith('test.md', 'test', '# hello')
  })

  it('索引失败时返回错误信息', async () => {
    mockIndexMarkdownDocumentAsync.mockRejectedValue(new Error('索引失败'))
    const result = await addKnowledgeDocument({
      filePath: 'test.md',
      title: 'test',
      content: '# hello',
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('索引失败')
  })
})

describe('isKnowledgeDocumentIndexed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('文档存在时返回 true', async () => {
    mockGetEmbeddingConfig.mockReturnValue({ embeddingModel: 'test-model' })
    mockLoadDocumentIndexMetadata.mockResolvedValue({ id: 'doc-1', totalChunks: 3, embeddedChunks: 3 })
    const result = await isKnowledgeDocumentIndexed('test.md')
    expect(result).toBe(true)
  })

  it('文档不存在时返回 false', async () => {
    mockGetEmbeddingConfig.mockReturnValue({ embeddingModel: 'test-model' })
    mockLoadDocumentIndexMetadata.mockResolvedValue(undefined)
    const result = await isKnowledgeDocumentIndexed('test.md')
    expect(result).toBe(false)
  })
})

describe('removeKnowledgeDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('多路径去重', async () => {
    mockRunSerializedDocumentOperation.mockImplementation(
      async (_path: string, op: () => Promise<void>) => op()
    )
    mockRemovePersistedDocumentByPathTransaction.mockResolvedValue({
      deleted: true,
      documentId: 'doc-1',
    })

    const result = await removeKnowledgeDocuments([
      'C:/test/doc.md',
      'C:/test/doc.md',
      'C:/test/other.md',
    ])

    expect(mockRunSerializedDocumentOperation).toHaveBeenCalledTimes(2)
    expect(result.success).toHaveLength(2)
    expect(result.failed).toHaveLength(0)
  })

  it('取消目标路径待执行定时器', async () => {
    mockRunSerializedDocumentOperation.mockImplementation(
      async (_path: string, op: () => Promise<void>) => op()
    )
    mockRemovePersistedDocumentByPathTransaction.mockResolvedValue({
      deleted: true,
      documentId: 'doc-1',
    })

    await removeKnowledgeDocuments(['C:/test/doc.md'])

    expect(mockCancelPendingIndexTimers).toHaveBeenCalled()
  })

  it('删除顺序：定时器取消 → 数据库事务 → 内存清理 → native index 清理', async () => {
    const callOrder: string[] = []
    mockCancelPendingIndexTimers.mockImplementation(() => callOrder.push('cancelTimers'))
    mockRunSerializedDocumentOperation.mockImplementation(
      async (_path: string, op: () => Promise<void>) => {
        callOrder.push('serializedStart')
        await op()
        callOrder.push('serializedEnd')
      }
    )
    mockRemovePersistedDocumentByPathTransaction.mockImplementation(async () => {
      callOrder.push('dbTransaction')
      return { deleted: true, documentId: 'doc-1', chunksDeleted: 1, embeddingJobsDeleted: 0 }
    })
    mockVectorStoreRemoveByFilePathFromMemory.mockImplementation(() => callOrder.push('memoryCleanup'))
    mockRemoveNativeRagIndexDocument.mockImplementation(async () => callOrder.push('nativeIndexCleanup'))

    await removeKnowledgeDocuments(['C:/test/doc.md'])

    expect(callOrder).toEqual([
      'cancelTimers',
      'serializedStart',
      'dbTransaction',
      'memoryCleanup',
      'nativeIndexCleanup',
      'serializedEnd',
    ])
  })

  it('单项失败返回部分成功结果', async () => {
    let callCount = 0
    mockRunSerializedDocumentOperation.mockImplementation(
      async (_path: string, op: () => Promise<void>) => {
        callCount++
        if (callCount === 1) {
          throw new Error('第一个文件失败')
        }
        return op()
      }
    )
    mockRemovePersistedDocumentByPathTransaction.mockResolvedValue({
      deleted: true,
      documentId: 'doc-2',
    })

    const result = await removeKnowledgeDocuments([
      'C:/test/fail.md',
      'C:/test/ok.md',
    ])

    expect(result.success).toEqual(['C:/test/ok.md'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].filePath).toBe('C:/test/fail.md')
    expect(result.failed[0].error).toBe('第一个文件失败')
  })

  it('文档不存在时返回失败', async () => {
    mockRunSerializedDocumentOperation.mockImplementation(
      async (_path: string, op: () => Promise<void>) => op()
    )
    mockRemovePersistedDocumentByPathTransaction.mockResolvedValue({
      deleted: false,
      documentId: undefined,
      chunksDeleted: 0,
      embeddingJobsDeleted: 0,
    })

    const result = await removeKnowledgeDocuments(['C:/test/missing.md'])

    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].error).toBe('文档未找到，可能已被移除')
  })
})

describe('listKnowledgeDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('复用 getKnowledgeDocumentStates', async () => {
    const mockStates = [
      { filePath: '/a.md', title: 'A', state: 'INDEXED', totalChunks: 3, embeddedChunks: 3 },
    ]
    mockGetKnowledgeDocumentStates.mockResolvedValue(mockStates)

    const result = await listKnowledgeDocuments()

    expect(result).toEqual(mockStates)
    expect(mockGetKnowledgeDocumentStates).toHaveBeenCalled()
  })
})