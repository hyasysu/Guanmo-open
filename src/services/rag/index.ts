export {
  ingestDocument,
  embedDocument,
  embedPendingChunks,
  searchRelevant,
  buildContext,
  getRagStats,
  removeDocument,
  updateRagConfig,
  getRagConfig,
  getDefaultConfig,
  vectorStore,
} from './pipeline'

export type { RAGStats, EmbedResult } from './pipeline'
export { chunkMarkdown } from './chunker'
export type { Chunk, Document, SearchResult, RAGConfig } from './types'
