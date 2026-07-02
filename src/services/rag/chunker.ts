import type { Chunk } from './types'
import { createContentHash } from './contentHash'
import { buildSemanticDocumentChunks } from './semanticChunker'

/**
 * Split Markdown content into semantic chunks for RAG.
 * The splitter keeps heading metadata and avoids cutting fenced code blocks.
 */
export function chunkMarkdown(
  content: string,
  documentId: string,
  _options: { chunkSize?: number; overlap?: number } = {}
): Chunk[] {
  const semanticChunks = buildSemanticDocumentChunks(content, true)
  const seenHashes = new Set<string>()
  const now = Date.now()
  return semanticChunks.flatMap((chunk) => {
    const contentHash = createContentHash(chunk.content)
    if (seenHashes.has(contentHash)) return []
    seenHashes.add(contentHash)
    const index = seenHashes.size - 1
    return [{
      id: `${documentId}-chunk-${index}`,
      documentId,
      content: chunk.content,
      contentHash,
      index,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      titlePath: chunk.headingPath,
      heading: chunk.heading,
      sourceType: 'markdown' as const,
      createdAt: now,
      updatedAt: now,
    }]
  })
}
