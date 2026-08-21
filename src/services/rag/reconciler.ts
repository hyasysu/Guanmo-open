import type { Chunk, Document } from './types'
import { createEmbeddingInputHash, EMBEDDING_PREPROCESS_VERSION } from './embeddingInput'
import type { DocumentIndexMetadata } from '@/services/database/persistence'

export interface IndexUpdateStats {
  total: number
  reused: number
  added: number
  deleted: number
  reembedded: number
}

export interface ReconciledDocument {
  document: Document
  stats: IndexUpdateStats
}

export function canSkipDocumentIndex(
  existing: Document | undefined,
  contentHash: string,
  embeddingModel: string | null,
  title = existing?.title,
): boolean {
  if (!existing || existing.contentHash !== contentHash || existing.title !== title) return false
  if (embeddingModel === null) return true
  return existing.chunks.every((chunk) => (
    chunk.embeddingModel === embeddingModel
    && chunk.embeddingPreprocessVersion === EMBEDDING_PREPROCESS_VERSION
    && Boolean(chunk.embeddingInputHash)
  ))
}

export function canSkipDocumentIndexMetadata(
  metadata: DocumentIndexMetadata | undefined,
  contentHash: string,
  embeddingModel: string | null,
  title = metadata?.title,
): boolean {
  if (!metadata || metadata.contentHash !== contentHash || metadata.title !== title) return false
  return embeddingModel === null || metadata.compatibleChunks === metadata.totalChunks
}

function allocateChunkId(documentId: string, usedIds: Set<string>, nextIndex: { value: number }): string {
  while (usedIds.has(`${documentId}-chunk-${nextIndex.value}`)) nextIndex.value += 1
  const id = `${documentId}-chunk-${nextIndex.value}`
  nextIndex.value += 1
  usedIds.add(id)
  return id
}

export async function reconcileDocumentChunks(
  existing: Document | undefined,
  nextDocument: Omit<Document, 'chunks'>,
  parsedChunks: Chunk[],
  embeddingModel: string | null,
): Promise<ReconciledDocument> {
  const oldChunks = existing?.chunks || []
  const usedOldIds = new Set<string>()

  const usedIds = new Set((existing?.chunks || []).map((chunk) => chunk.id))
  const nextIdIndex = { value: 0 }
  const chunks: Chunk[] = []
  let reused = 0
  let added = 0
  let reembedded = 0

  const nextInputHashes = await Promise.all(parsedChunks.map((chunk) => (
    createEmbeddingInputHash(chunk, nextDocument.title)
  )))
  for (let index = 0; index < parsedChunks.length; index += 1) {
    const parsedChunk = parsedChunks[index]
    const embeddingInputHash = nextInputHashes[index]
    const candidates = oldChunks.filter((candidate) => (
      !usedOldIds.has(candidate.id) && candidate.content === parsedChunk.content
    ))
    const oldChunk = candidates.sort((left, right) => {
      const affinity = (candidate: Chunk) => (
        (candidate.titlePath?.join('\0') === parsedChunk.titlePath?.join('\0') ? 4 : 0)
        + (candidate.sourceType === parsedChunk.sourceType ? 2 : 0)
        - Math.abs(candidate.index - parsedChunk.index)
      )
      return affinity(right) - affinity(left)
    })[0]
    if (oldChunk) usedOldIds.add(oldChunk.id)

    const canReuseEmbedding = Boolean(
      oldChunk?.embedding && (
        embeddingModel === null
          ? true
          : oldChunk.embeddingModel === embeddingModel
            && oldChunk.embeddingPreprocessVersion === EMBEDDING_PREPROCESS_VERSION
            && oldChunk.embeddingInputHash === embeddingInputHash
      )
    )
    const id = oldChunk?.id || allocateChunkId(nextDocument.id, usedIds, nextIdIndex)
    if (canReuseEmbedding) reused += 1
    else if (embeddingModel !== null) reembedded += 1
    if (!oldChunk) added += 1

    chunks.push({
      ...parsedChunk,
      id,
      documentId: nextDocument.id,
      embeddingInputHash,
      embeddingModel: canReuseEmbedding ? oldChunk?.embeddingModel || null : embeddingModel,
      embeddingPreprocessVersion: canReuseEmbedding
        ? oldChunk?.embeddingPreprocessVersion || null
        : EMBEDDING_PREPROCESS_VERSION,
      embedding: canReuseEmbedding ? oldChunk?.embedding : undefined,
      createdAt: oldChunk?.createdAt || parsedChunk.createdAt,
      updatedAt: Date.now(),
    })
  }

  const deleted = oldChunks.length - usedOldIds.size
  return {
    document: { ...nextDocument, chunks },
    stats: { total: chunks.length, reused, added, deleted, reembedded },
  }
}
