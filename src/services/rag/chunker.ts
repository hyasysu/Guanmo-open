import type { Chunk } from './types'

/**
 * Split Markdown content into chunks for RAG.
 * Respects heading boundaries and paragraph structure.
 */
export function chunkMarkdown(
  content: string,
  documentId: string,
  options: { chunkSize?: number; overlap?: number } = {}
): Chunk[] {
  const { chunkSize = 1000, overlap = 200 } = options
  const lines = content.split('\n')
  const chunks: Chunk[] = []
  let currentChunk: string[] = []
  let currentStartLine = 1
  let chunkIndex = 0
  let currentLength = 0

  const flushChunk = () => {
    if (currentChunk.length === 0) return

    const text = currentChunk.join('\n').trim()
    if (text.length === 0) return

    chunks.push({
      id: `${documentId}-chunk-${chunkIndex}`,
      documentId,
      content: text,
      index: chunkIndex,
      startLine: currentStartLine,
      endLine: currentStartLine + currentChunk.length - 1,
    })
    chunkIndex++
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isNewHeading = /^#{1,3}\s/.test(line)

    // Flush on heading boundary if we have enough content
    if (isNewHeading && currentLength > chunkSize * 0.5) {
      flushChunk()

      // Add overlap from previous chunk
      const overlapLines: string[] = []
      let overlapLen = 0
      for (let j = currentChunk.length - 1; j >= 0 && overlapLen < overlap; j--) {
        overlapLines.unshift(currentChunk[j])
        overlapLen += currentChunk[j].length
      }

      currentChunk = overlapLines
      currentStartLine = i - overlapLines.length + 1
      currentLength = overlapLen
    }

    currentChunk.push(line)
    currentLength += line.length

    // Flush when chunk is large enough (unless on a heading)
    if (currentLength >= chunkSize && !isNewHeading) {
      flushChunk()
      currentChunk = []
      currentStartLine = i + 2
      currentLength = 0
    }
  }

  // Flush remaining
  flushChunk()

  return chunks
}
