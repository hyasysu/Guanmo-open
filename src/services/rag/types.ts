export type RetrievalMode = 'vector' | 'keyword'

export interface Chunk {
  id: string
  documentId: string
  content: string
  index: number
  startLine: number
  endLine: number
  embedding?: number[]
}

export interface Document {
  id: string
  filePath: string
  title: string
  content: string
  lastModified: number
  chunks: Chunk[]
}

export interface SearchResult {
  chunk: Chunk
  score: number
  document: Document
  retrievalMode: RetrievalMode
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
  chunkSize: number
  chunkOverlap: number
  topK: number
  similarityThreshold: number
}
