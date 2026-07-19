import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/hooks/useTauri'
import { UnsupportedCapabilityError } from '@/services/externalHttp'
import type { SearchResult } from './types'

export type RagIndexStatus = 'idle' | 'initializing' | 'ready' | 'failed'
export type RagSearchProgress = 'initializing' | 'ready' | 'searching' | 'fallback'

export interface RagIndexState {
  status: RagIndexStatus
  documentCount: number
  chunkCount: number
  validVectorCount: number
  skippedVectorCount: number
  error?: string
}

export interface NativeRagSearchRequest {
  queryText: string
  queryVector: number[] | null
  topK: number
  threshold: number
  filePaths?: string[]
  keywordSearchEnabled: boolean
  currentFilePath?: string
  preferCurrentFile: boolean
  preferRecentDocuments: boolean
  keywordOnlyFallback?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`RAG index response.${field} is invalid`)
  return value
}

export function decodeRagIndexState(value: unknown): RagIndexState {
  if (!isRecord(value) || !['idle', 'initializing', 'ready', 'failed'].includes(String(value.status))) {
    throw new Error('RAG index state response is invalid')
  }
  return {
    status: value.status as RagIndexStatus,
    documentCount: finiteNumber(value.documentCount, 'documentCount'),
    chunkCount: finiteNumber(value.chunkCount, 'chunkCount'),
    validVectorCount: finiteNumber(value.validVectorCount, 'validVectorCount'),
    skippedVectorCount: finiteNumber(value.skippedVectorCount, 'skippedVectorCount'),
    error: typeof value.error === 'string' ? value.error : undefined,
  }
}

export function decodeRagSearchResults(value: unknown): SearchResult[] {
  if (!Array.isArray(value)) throw new Error('RAG search response is invalid')
  return value.map((entry) => {
    if (!isRecord(entry) || !isRecord(entry.chunk) || !isRecord(entry.document)) throw new Error('RAG search hit is invalid')
    const chunk = entry.chunk
    const document = entry.document
    if (typeof chunk.id !== 'string' || typeof chunk.documentId !== 'string' || typeof chunk.content !== 'string'
      || typeof document.id !== 'string' || typeof document.filePath !== 'string' || typeof document.title !== 'string') {
      throw new Error('RAG search hit fields are invalid')
    }
    const retrievalMode = entry.retrievalMode
    if (retrievalMode !== 'vector' && retrievalMode !== 'keyword' && retrievalMode !== 'hybrid') {
      throw new Error('RAG search retrieval mode is invalid')
    }
    return {
      chunk: {
        id: chunk.id,
        documentId: chunk.documentId,
        content: chunk.content,
        contentHash: typeof chunk.contentHash === 'string' ? chunk.contentHash : undefined,
        index: finiteNumber(chunk.index, 'chunk.index'),
        startLine: finiteNumber(chunk.startLine, 'chunk.startLine'),
        endLine: finiteNumber(chunk.endLine, 'chunk.endLine'),
        titlePath: Array.isArray(chunk.titlePath) && chunk.titlePath.every((item) => typeof item === 'string') ? chunk.titlePath : undefined,
        heading: typeof chunk.heading === 'string' ? chunk.heading : undefined,
        sourceType: chunk.sourceType === 'text' ? 'text' as const : 'markdown' as const,
      },
      document: {
        id: document.id,
        filePath: document.filePath,
        title: document.title,
        content: '',
        lastModified: finiteNumber(document.lastModified, 'document.lastModified'),
        chunks: [],
      },
      score: finiteNumber(entry.score, 'score'),
      retrievalMode,
      keywordScore: typeof entry.keywordScore === 'number' ? entry.keywordScore : undefined,
      vectorScore: typeof entry.vectorScore === 'number' ? entry.vectorScore : undefined,
    }
  })
}

function ensureDesktop(): void {
  if (!isTauri()) throw new UnsupportedCapabilityError('RAG 索引')
}

function awaitForRequest<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export async function getNativeRagIndexState(): Promise<RagIndexState> {
  ensureDesktop()
  return decodeRagIndexState(await invoke('get_rag_index_state'))
}

export async function initializeNativeRagIndex(signal?: AbortSignal): Promise<RagIndexState> {
  ensureDesktop()
  return decodeRagIndexState(await awaitForRequest(invoke('initialize_rag_index'), signal))
}

export async function searchNativeRagIndex(
  request: NativeRagSearchRequest,
  onProgress?: (progress: RagSearchProgress) => void,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  onProgress?.('searching')
  return decodeRagSearchResults(await awaitForRequest(invoke('search_rag_index', { request }), signal))
}

export async function prepareNativeRagIndex(
  onProgress?: (progress: RagSearchProgress) => void,
  signal?: AbortSignal,
): Promise<'already_ready' | 'ready' | 'fallback'> {
  const state = await getNativeRagIndexState()
  if (state.status !== 'ready') {
    onProgress?.('initializing')
    try {
      await initializeNativeRagIndex(signal)
      onProgress?.('ready')
      return 'ready'
    } catch (error) {
      if (signal?.aborted) throw error
      onProgress?.('fallback')
      return 'fallback'
    }
  }
  return 'already_ready'
}

export async function refreshNativeRagIndexDocument(path: string): Promise<void> {
  if (!isTauri()) return
  await invoke('refresh_rag_index_document', { path })
}

export async function removeNativeRagIndexDocument(path: string): Promise<void> {
  if (!isTauri()) return
  await invoke('remove_rag_index_document', { path })
}
