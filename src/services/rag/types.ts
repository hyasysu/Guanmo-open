export type RetrievalMode = 'vector' | 'keyword' | 'hybrid'

export interface Chunk {
  id: string
  documentId: string
  content: string
  contentHash?: string
  embeddingInputHash?: string
  embeddingModel?: string | null
  embeddingPreprocessVersion?: string | null
  index: number
  startLine: number
  endLine: number
  titlePath?: string[]
  heading?: string
  sourceType?: 'markdown' | 'text'
  createdAt?: number
  updatedAt?: number
  embedding?: number[]
}

export interface NeighborContextChunk extends Chunk {
  contextRole: 'neighbor-context'
}

export interface Document {
  id: string
  filePath: string
  title: string
  content: string
  contentHash?: string
  lastModified: number
  chunks: Chunk[]
}

export interface SearchResult {
  chunk: Chunk
  score: number
  document: Document
  retrievalMode: RetrievalMode
  keywordScore?: number
  vectorScore?: number
  neighborChunks?: NeighborContextChunk[]
}

export interface RAGContextSource {
  result: SearchResult
  sourceNumber: number
  referenceId?: string
}

export interface SkippedRAGContextSource extends RAGContextSource {
  reason: 'budget_exceeded'
}

export interface RAGContextCoverage {
  requested: number
  included: number
  skipped: number
}

export interface RAGContextBuildResult {
  text: string
  includedSources: RAGContextSource[]
  skippedSources: SkippedRAGContextSource[]
  coverage: RAGContextCoverage
}

export interface RAGContextBuildOptions {
  referenceIds?: boolean
}

export interface Memory {
  id: string
  content: string
  category: string
  createdAt: number
  updatedAt: number
  embedding?: number[]
}

export interface RAGConfig {
  topK: number
  similarityThreshold: number
  keywordSearchEnabled: boolean
  preferCurrentFile: boolean
  preferRecentDocuments: boolean
}
