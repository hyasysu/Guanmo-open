import type { Chunk, Document, SearchResult } from './types'
import {
  persistDocument,
  removePersistedDocument,
  loadAllDocuments,
  persistEmbedding,
} from '@/services/database/persistence'
import { normalizeFilePath } from '@/services/pathIdentity'

/**
 * In-memory vector store for RAG with optional DB persistence.
 */
class VectorStore {
  private documents: Map<string, Document> = new Map()
  private chunks: Map<string, Chunk> = new Map()
  private pendingPersistence: Set<Promise<void>> = new Set()
  private _persistenceEnabled = false

  get persistenceEnabled(): boolean {
    return this._persistenceEnabled
  }

  private trackPersistence(promise: Promise<void>): void {
    this.pendingPersistence.add(promise)
    promise.finally(() => {
      this.pendingPersistence.delete(promise)
    })
  }

  async flushPersistence(): Promise<void> {
    while (this.pendingPersistence.size > 0) {
      await Promise.all(Array.from(this.pendingPersistence))
    }
  }

  /**
   * Load persisted documents from database.
   * Call this after initDatabase() succeeds.
   */
  async loadFromDatabase(): Promise<void> {
    try {
      const inMemoryDocs = this.getAllDocuments()
      const docs = await loadAllDocuments()
      this.documents.clear()
      this.chunks.clear()
      for (const doc of docs) {
        this.documents.set(doc.id, doc)
        for (const chunk of doc.chunks) {
          this.chunks.set(chunk.id, chunk)
        }
      }
      this._persistenceEnabled = true
      for (const doc of inMemoryDocs) {
        this.addDocument(doc)
      }
      await this.flushPersistence()
      console.log(`[VectorStore] Loaded ${docs.length} documents from database`)
    } catch (err) {
      console.warn('[VectorStore] Failed to load from database:', err)
    }
  }

  addDocument(doc: Document): void {
    const existing = this.findByFilePath(doc.filePath)
    if (existing && existing.id !== doc.id) {
      for (const chunk of existing.chunks) {
        this.chunks.delete(chunk.id)
      }
      this.documents.delete(existing.id)
    }
    this.documents.set(doc.id, doc)
    for (const chunk of doc.chunks) {
      this.chunks.set(chunk.id, chunk)
    }
    // Persist in background (non-blocking)
    if (this._persistenceEnabled) {
      this.trackPersistence(
        persistDocument(doc).catch((err) =>
          console.warn('[VectorStore] persist failed:', err)
        )
      )
    }
  }

  removeDocument(docId: string): void {
    const doc = this.documents.get(docId)
    if (doc) {
      for (const chunk of doc.chunks) {
        this.chunks.delete(chunk.id)
      }
      this.documents.delete(docId)
      if (this._persistenceEnabled) {
        this.trackPersistence(
          removePersistedDocument(docId).catch((err) =>
            console.warn('[VectorStore] remove persist failed:', err)
          )
        )
      }
    }
  }

  removeByFilePath(filePath: string): void {
    const doc = this.findByFilePath(filePath)
    if (doc) {
      this.removeDocument(doc.id)
    }
  }

  getDocument(docId: string): Document | undefined {
    return this.documents.get(docId)
  }

  findByFilePath(filePath: string): Document | undefined {
    const normalized = normalizeFilePath(filePath)
    for (const doc of this.documents.values()) {
      if (normalizeFilePath(doc.filePath) === normalized) return doc
    }
    return undefined
  }

  private isInScope(docFilePath: string, filePaths: string[]): boolean {
    const normalizedDoc = normalizeFilePath(docFilePath)
    return filePaths.some((p) => normalizeFilePath(p) === normalizedDoc)
  }

  getAllDocuments(): Document[] {
    return Array.from(this.documents.values())
  }

  /**
   * Cosine similarity between two vectors.
   * Returns 0 for zero vectors to avoid division by zero.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0
    let dotProduct = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    if (denom === 0) return 0
    return dotProduct / denom
  }

  /**
   * Sort results by score descending and truncate to topK.
   */
  private sortAndTruncate(results: SearchResult[], topK: number): SearchResult[] {
    results.sort((a, b) => b.score - a.score)
    const byDocument = new Map<string, SearchResult[]>()
    for (const result of results) {
      const key = normalizeFilePath(result.document.filePath)
      const group = byDocument.get(key)
      if (group) {
        group.push(result)
      } else {
        byDocument.set(key, [result])
      }
    }

    const diversified: SearchResult[] = []
    while (diversified.length < topK) {
      let added = false
      for (const group of byDocument.values()) {
        const next = group.shift()
        if (!next) continue
        diversified.push(next)
        added = true
        if (diversified.length >= topK) break
      }
      if (!added) break
    }
    return diversified
  }

  /**
   * Search for similar chunks given a query embedding.
   */
  search(
    queryEmbedding: number[],
    topK: number = 5,
    threshold: number = 0.5,
    filePaths?: string[]
  ): SearchResult[] {
    const results: SearchResult[] = []

    for (const chunk of this.chunks.values()) {
      if (!chunk.embedding) continue

      const doc = this.documents.get(chunk.documentId)
      if (!doc) continue
      // Scope 过滤：只搜索指定文件路径
      if (filePaths && filePaths.length > 0 && !this.isInScope(doc.filePath, filePaths)) continue

      const score = this.cosineSimilarity(queryEmbedding, chunk.embedding)
      if (score >= threshold) {
        results.push({ chunk, score, document: doc, retrievalMode: 'vector' })
      }
    }

    return this.sortAndTruncate(results, topK)
  }

  /**
   * Simple keyword search (fallback when no embeddings).
   */
  keywordSearch(query: string, topK: number = 5, filePaths?: string[]): SearchResult[] {
    const queryLower = query.toLowerCase()
    const queryTerms = queryLower.split(/\s+/).filter(Boolean)
    if (queryTerms.length === 0) return []

    const results: SearchResult[] = []

    for (const chunk of this.chunks.values()) {
      const doc = this.documents.get(chunk.documentId)
      if (!doc) continue
      // Scope 过滤
      if (filePaths && filePaths.length > 0 && !this.isInScope(doc.filePath, filePaths)) continue

      const contentLower = chunk.content.toLowerCase()
      let matchCount = 0
      for (const term of queryTerms) {
        if (contentLower.includes(term)) matchCount++
      }
      if (matchCount > 0) {
        const score = matchCount / queryTerms.length
        results.push({ chunk, score, document: doc, retrievalMode: 'keyword' })
      }
    }

    return this.sortAndTruncate(results, topK)
  }

  /**
   * Save an embedding to the database.
   */
  saveEmbedding(chunkId: string, embedding: number[]): void {
    const chunk = this.chunks.get(chunkId)
    if (chunk) {
      chunk.embedding = embedding
    }
    if (this._persistenceEnabled) {
      this.trackPersistence(
        persistEmbedding(chunkId, embedding).catch((err) =>
          console.warn('[VectorStore] persist embedding failed:', err)
        )
      )
    }
  }

  get chunkCount(): number {
    return this.chunks.size
  }

  get documentCount(): number {
    return this.documents.size
  }

  clear(): void {
    this.documents.clear()
    this.chunks.clear()
  }
}

export const vectorStore = new VectorStore()
