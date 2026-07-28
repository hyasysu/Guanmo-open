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
  runSerializedDocumentOperation,
  getKnowledgeDocumentStates,
} from './pipeline'

export type { RAGStats, EmbedResult, KnowledgeDocumentState, KnowledgeIndexState } from './pipeline'
export { chunkMarkdown } from './chunker'
export type { Chunk, Document, SearchResult, RAGConfig } from './types'
export {
  indexMarkdownDocument,
  indexMarkdownDocumentAsync,
  cancelPendingIndexTimers,
  getPendingIndexTimerPaths,
  scheduleMarkdownDocumentIndex,
  indexWorkspaceMarkdown,
  isMarkdownPath,
} from './indexer'
export type { WorkspaceIndexResult } from './indexer'
export {
  listKnowledgeDocuments,
  addKnowledgeDocument,
  removeKnowledgeDocuments,
  isKnowledgeDocumentIndexed,
} from './knowledgeBase'
export type {
  KnowledgeDocumentItem,
  AddKnowledgeResult,
  RemoveKnowledgeResult,
} from './knowledgeBase'
