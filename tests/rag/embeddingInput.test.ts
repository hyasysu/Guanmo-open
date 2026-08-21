import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chunk, Document } from '@/services/rag/types'
import {
  EMBEDDING_INPUT_MAX_CHARS,
  EMBEDDING_PREPROCESS_VERSION,
  buildEmbeddingInputs,
  createEmbeddingInputHash,
  getEmbeddingInput,
} from '@/services/rag/embeddingInput'
import { canSkipDocumentIndex, reconcileDocumentChunks } from '@/services/rag/reconciler'

const mockBatchEmbedding = vi.fn()
const mockEmbedding = vi.fn()
const mockAddDocument = vi.fn()
const mockFlushPersistence = vi.fn(async () => undefined)
const mockRefreshNativeIndex = vi.fn(async () => undefined)

vi.mock('@/services/ai/aiClient', () => ({
  getEmbeddingClient: () => ({
    batchEmbedding: mockBatchEmbedding,
    embedding: mockEmbedding,
  }),
  getEmbeddingConfig: () => ({ embeddingModel: 'anonymous-test-model' }),
  isEmbeddingReady: () => true,
}))

vi.mock('@/services/rag/vectorStore', () => ({
  vectorStore: {
    addDocument: mockAddDocument,
    flushPersistence: mockFlushPersistence,
  },
}))

vi.mock('@/services/rag/nativeIndex', () => ({
  refreshNativeRagIndexDocument: mockRefreshNativeIndex,
}))

function createChunk(content: string, startLine = 1): Chunk {
  return {
    id: 'anonymous-parent-chunk',
    documentId: 'anonymous-document',
    content,
    index: 0,
    startLine,
    endLine: startLine + content.split('\n').length - 1,
  }
}

describe('buildEmbeddingInputs', () => {
  it.each([
    ['code', `\`\`\`ts\n${'const value = 1;\n'.repeat(8)}\`\`\``],
    ['formula', `$$\n${'x + y = z\n'.repeat(10)}$$`],
    ['html', `<section>\n${'<span>value</span>\n'.repeat(8)}</section>`],
    ['plain text', 'anonymous'.repeat(20)],
  ])('splits oversized %s without changing the parent content', (_kind, content) => {
    const chunk = createChunk(content, 10)
    const inputs = buildEmbeddingInputs(chunk, 80)

    expect(inputs.length).toBeGreaterThan(1)
    expect(inputs.map((input) => input.text.replace(getEmbeddingInput({ ...chunk, content: '' }), '')).join('')).toBe(content)
    expect(inputs.every((input) => input.text.length <= 80)).toBe(true)
    expect(inputs[0].startLine).toBe(10)
    expect(inputs.at(-1)?.endLine).toBe(chunk.endLine)
    expect(inputs.map((input) => input.partIndex)).toEqual(inputs.map((_, index) => index))
  })

  it('keeps exact line ranges across newline boundaries', () => {
    const chunk = createChunk('one\ntwo\nthree\nfour', 20)

    const prefix = getEmbeddingInput({ ...chunk, content: '' })
    expect(buildEmbeddingInputs(chunk, prefix.length + 8)).toEqual([
      expect.objectContaining({ text: `${prefix}one\ntwo\n`, startLine: 20, endLine: 21 }),
      expect.objectContaining({ text: `${prefix}three\n`, startLine: 22, endLine: 22 }),
      expect.objectContaining({ text: `${prefix}four`, startLine: 23, endLine: 23 }),
    ])
  })
})

describe('embedDocument oversized input fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aggregates successful child vectors and reports a failed child without content', async () => {
    const privateMarker = 'PRIVATE_MARKER_MUST_NOT_APPEAR'
    const content = [
      'a'.repeat(EMBEDDING_INPUT_MAX_CHARS),
      privateMarker.repeat(100),
      'z'.repeat(EMBEDDING_INPUT_MAX_CHARS),
    ].join('\n')
    const chunk = createChunk(content, 30)
    const document: Document = {
      id: 'anonymous-document',
      filePath: 'D:/anonymous/oversized.md',
      title: 'anonymous',
      content,
      lastModified: 1,
      chunks: [chunk],
    }

    mockBatchEmbedding.mockRejectedValueOnce(new Error('provider rejected oversized batch'))
    mockEmbedding.mockImplementation(async (text: string) => {
      if (text.includes(privateMarker)) throw new Error(`rejected input: ${privateMarker}`)
      return { embedding: text.includes('a'.repeat(100)) ? [1, 0] : [0, 1] }
    })

    const { embedDocument } = await import('@/services/rag/pipeline')
    const result = await embedDocument(document)

    expect(mockBatchEmbedding).toHaveBeenCalledTimes(1)
    const batchInputs = mockBatchEmbedding.mock.calls[0][0] as string[]
    expect(batchInputs.every((text) => text.length <= EMBEDDING_INPUT_MAX_CHARS)).toBe(true)
    expect(mockEmbedding).toHaveBeenCalledTimes(batchInputs.length)
    expect(chunk.embedding).toEqual([1 / 3, 2 / 3])
    expect(result.embedded).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('anonymous-parent-chunk')
    expect(result.errors[0]).toMatch(/lines \d+-\d+/)
    expect(result.errors.join('\n')).not.toContain(privateMarker)
    expect(mockAddDocument).toHaveBeenCalledWith(document)
    expect(mockFlushPersistence).toHaveBeenCalledTimes(1)
    expect(mockRefreshNativeIndex).toHaveBeenCalledWith(document.filePath)
  }, 15_000)

  it('continues embedding other parent chunks when every input of one parent fails', async () => {
    const failedChunk = createChunk('reject-this-input')
    const successfulChunk = {
      ...createChunk('safe-input', 2),
      id: 'anonymous-successful-chunk',
      index: 1,
    }
    const document: Document = {
      id: 'anonymous-document',
      filePath: 'D:/anonymous/partial-failure.md',
      title: 'anonymous',
      content: `${failedChunk.content}\n${successfulChunk.content}`,
      lastModified: 1,
      chunks: [failedChunk, successfulChunk],
    }

    mockBatchEmbedding.mockRejectedValueOnce(new Error('one input was rejected'))
    mockEmbedding.mockImplementation(async (text: string) => {
      if (text.includes('reject')) throw new Error('provider echoed reject-this-input')
      return { embedding: [0.25, 0.75] }
    })

    const { embedDocument } = await import('@/services/rag/pipeline')
    const result = await embedDocument(document)

    expect(failedChunk.embedding).toBeUndefined()
    expect(successfulChunk.embedding).toEqual([0.25, 0.75])
    expect(result).toMatchObject({ embedded: 1, failed: 1 })
    expect(result.errors.join('\n')).not.toContain('reject-this-input')
  })
})

describe('embedding preprocessing compatibility', () => {
  it('keeps the parent id while progressively replacing a v1 vector', async () => {
    const content = 'unchanged anonymous parent chunk'
    const inputHash = await createEmbeddingInputHash({ content })
    const oldChunk: Chunk = {
      ...createChunk(content, 7),
      id: 'stable-parent-id',
      embedding: [1, 0],
      embeddingInputHash: inputHash,
      embeddingModel: 'anonymous-test-model',
      embeddingPreprocessVersion: 'markdown-chunk-v1',
    }
    const existing: Document = {
      id: 'anonymous-document',
      filePath: 'D:/anonymous/compatible.md',
      title: 'anonymous',
      content,
      contentHash: 'document-hash',
      lastModified: 1,
      chunks: [oldChunk],
    }

    expect(canSkipDocumentIndex(existing, 'document-hash', 'anonymous-test-model')).toBe(false)
    const reconciled = await reconcileDocumentChunks(
      existing,
      {
        id: existing.id,
        filePath: existing.filePath,
        title: existing.title,
        content: existing.content,
        contentHash: existing.contentHash,
        lastModified: existing.lastModified,
      },
      [createChunk(content, 7)],
      'anonymous-test-model',
    )

    expect(reconciled.document.chunks[0]).toMatchObject({
      id: 'stable-parent-id',
      embedding: undefined,
      embeddingPreprocessVersion: EMBEDDING_PREPROCESS_VERSION,
    })
    expect(reconciled.stats.reembedded).toBe(1)
  })

  it('does not skip an unchanged body when the document title changed', async () => {
    const content = 'unchanged body'
    const chunk = {
      ...createChunk(content),
      embedding: [1, 0],
      embeddingModel: 'anonymous-test-model',
      embeddingPreprocessVersion: EMBEDDING_PREPROCESS_VERSION,
      embeddingInputHash: await createEmbeddingInputHash(createChunk(content), 'Old title'),
    }
    const existing: Document = {
      id: 'anonymous-document', filePath: 'D:/anonymous/title.md', title: 'Old title', content,
      contentHash: 'same-hash', lastModified: 1, chunks: [chunk],
    }

    expect(canSkipDocumentIndex(existing, 'same-hash', 'anonymous-test-model', 'Old title')).toBe(true)
    expect(canSkipDocumentIndex(existing, 'same-hash', 'anonymous-test-model', 'New title')).toBe(false)
  })

  it('versions the document title, heading path and block type in the input hash', async () => {
    const chunk = {
      ...createChunk('same anonymous body'),
      titlePath: ['Parent', 'Child'],
      sourceType: 'markdown' as const,
    }
    const original = await createEmbeddingInputHash(chunk, 'Document A')

    await expect(createEmbeddingInputHash(chunk, 'Document B')).resolves.not.toBe(original)
    await expect(createEmbeddingInputHash({ ...chunk, titlePath: ['Other'] }, 'Document A')).resolves.not.toBe(original)
    await expect(createEmbeddingInputHash({ ...chunk, sourceType: 'text' }, 'Document A')).resolves.not.toBe(original)
    expect(getEmbeddingInput(chunk, 'Document A')).toContain('文档标题：Document A')
    expect(getEmbeddingInput(chunk, 'Document A')).toContain('标题路径：Parent > Child')
    expect(getEmbeddingInput(chunk, 'Document A')).toContain('块类型：markdown')
  })

  it('keeps the chunk id but rebuilds its vector when only the document title changes', async () => {
    const content = 'same body under a renamed document'
    const oldChunk: Chunk = {
      ...createChunk(content),
      id: 'stable-title-change-id',
      embedding: [1, 0],
      embeddingInputHash: await createEmbeddingInputHash(createChunk(content), 'Old title'),
      embeddingModel: 'anonymous-test-model',
      embeddingPreprocessVersion: EMBEDDING_PREPROCESS_VERSION,
    }
    const existing: Document = {
      id: 'anonymous-document', filePath: 'D:/anonymous/title.md', title: 'Old title', content,
      contentHash: 'same-document-hash', lastModified: 1, chunks: [oldChunk],
    }
    const reconciled = await reconcileDocumentChunks(
      existing,
      {
        id: existing.id, filePath: existing.filePath, title: 'New title', content: existing.content,
        contentHash: existing.contentHash, lastModified: existing.lastModified,
      },
      [createChunk(content)],
      'anonymous-test-model',
    )

    expect(reconciled.document.chunks[0]).toMatchObject({
      id: 'stable-title-change-id', embedding: undefined,
      embeddingPreprocessVersion: EMBEDDING_PREPROCESS_VERSION,
    })
    expect(reconciled.stats.reembedded).toBe(1)
  })
})
