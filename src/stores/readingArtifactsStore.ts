/**
 * 阅读成果状态存储。
 *
 * 仅维护 UI 所需的列表、筛选与选中状态；持久化由 readingArtifacts repository 完成。
 * 删除成果不会改动原文；来源失效时由组件根据锚点校验结果展示恢复提示。
 */
import { create } from 'zustand'
import type { ChatMessageSource, ReadingScope } from '@/services/ai/types'
import {
  type ReadingArtifact,
  type ReadingArtifactType,
  type ReadingArtifactSourceAnchor,
  type ReadingArtifactReference,
  type SourceAnchorStatus,
  buildReadingArtifactReferences,
  persistReadingArtifact,
  loadReadingArtifactById,
  loadReadingArtifactsPage,
  deleteReadingArtifact,
  checkReadingArtifactSource,
  mergeReadingArtifactQuestionMetadata,
  mergeReadingArtifactReferencesMetadata,
} from '@/services/database/readingArtifacts'
import { loadDocumentContentHashByPath } from '@/services/database/persistence'

export type ReadingArtifactFilter = ReadingArtifactType | 'all'

export const READING_ARTIFACT_PAGE_SIZE = 20

interface ReadingArtifactsState {
  artifacts: ReadingArtifact[]
  filter: ReadingArtifactFilter
  query: string
  page: number
  pageSize: number
  total: number
  loading: boolean
  selectedId: string | null
  /** 已校验的来源锚点状态缓存：artifactId -> status */
  anchorStatuses: Record<string, SourceAnchorStatus>

  loadArtifacts: () => Promise<void>
  setFilter: (filter: ReadingArtifactFilter) => void
  setQuery: (query: string) => void
  setPage: (page: number) => void
  setSelected: (id: string | null) => void
  deleteArtifact: (id: string) => Promise<void>
  saveArtifactFromMessage: (input: SaveFromMessageInput) => Promise<ReadingArtifact | undefined>
  checkAnchor: (artifact: ReadingArtifact) => Promise<void>
  resetAnchorStatus: (id: string) => void
}

export interface SaveFromMessageInput {
  type: ReadingArtifactType
  title: string
  content: string
  sources?: ChatMessageSource[]
  contextScope?: ReadingScope
  messageId?: string
  /** 产生该 AI 回复的原始用户提问，写入 structured_content 元数据。 */
  question?: string
  /** 类型专属结构化字段，经运行时解码后写入 structured_content */
  structuredContent?: unknown | null
}

function buildAnchorFromReferences(
  references: readonly ReadingArtifactReference[],
  contextScope: ReadingScope | undefined,
  messageId: string | undefined,
): { source: ReadingArtifactSourceAnchor | null; contentHashPromise: Promise<string | undefined> } {
  const localSource = references.find((reference) => reference.kind === 'local')
  if (!localSource) {
    return { source: null, contentHashPromise: Promise.resolve(undefined) }
  }
  const headingPath = localSource.titlePath && localSource.titlePath.length > 0 ? localSource.titlePath : null
  const source: ReadingArtifactSourceAnchor = {
    filePath: localSource.filePath,
    fileName: localSource.fileName,
    contentHash: null,
    headingPath,
    startLine: localSource.startLine,
    endLine: localSource.endLine,
    quote: localSource.heading ? localSource.heading : null,
    messageId: messageId ?? null,
    scope: contextScope ?? null,
  }
  return {
    source,
    contentHashPromise: loadDocumentContentHashByPath(localSource.filePath),
  }
}

function generateArtifactId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `artifact-${crypto.randomUUID()}`
  }
  return `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizePage(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

let loadRequestSequence = 0

export const useReadingArtifactsStore = create<ReadingArtifactsState>((set, get) => ({
  artifacts: [],
  filter: 'all',
  query: '',
  page: 1,
  pageSize: READING_ARTIFACT_PAGE_SIZE,
  total: 0,
  loading: false,
  selectedId: null,
  anchorStatuses: {},

  loadArtifacts: async () => {
    const requestId = ++loadRequestSequence
    const { filter, query, page, pageSize } = get()
    set({ loading: true })
    try {
      const result = await loadReadingArtifactsPage({
        type: filter === 'all' ? undefined : filter,
        status: 'active',
        query,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      if (requestId !== loadRequestSequence) return
      const pageCount = Math.max(1, Math.ceil(result.total / pageSize))
      const validPage = Math.min(page, pageCount)
      if (validPage !== page) {
        set({ page: validPage })
        await get().loadArtifacts()
        return
      }
      set({ artifacts: result.artifacts, total: result.total, loading: false })
    } catch {
      if (requestId === loadRequestSequence) set({ loading: false })
    }
  },

  setFilter: (filter) => set({ filter, page: 1 }),

  setQuery: (query) => set({ query, page: 1 }),

  setPage: (page) => set({ page: normalizePage(page) }),

  setSelected: (id) => set({ selectedId: id }),

  deleteArtifact: async (id) => {
    await deleteReadingArtifact(id)
    set((state) => ({
      selectedId: state.selectedId === id ? null : state.selectedId,
      anchorStatuses: Object.fromEntries(
        Object.entries(state.anchorStatuses).filter(([key]) => key !== id),
      ),
    }))
    await get().loadArtifacts()
  },

  saveArtifactFromMessage: async (input) => {
    const references = buildReadingArtifactReferences(input.sources)
    const { source, contentHashPromise } = buildAnchorFromReferences(
      references,
      input.contextScope,
      input.messageId,
    )
    // 异步补全来源内容哈希；若文档未索引则为 null（来源校验退化为 missing/valid）
    const contentHash = await contentHashPromise.catch(() => undefined)
    if (source && contentHash) source.contentHash = contentHash
    const id = generateArtifactId()
    await persistReadingArtifact({
      id,
      type: input.type,
      title: input.title,
      content: input.content,
      structuredContent: mergeReadingArtifactQuestionMetadata(
        mergeReadingArtifactReferencesMetadata(input.structuredContent, references),
        input.question,
      ),
      source,
    })
    const saved = await loadReadingArtifactById(id)
    await get().loadArtifacts()
    return saved
  },

  checkAnchor: async (artifact) => {
    if (!artifact.source?.filePath) {
      set((state) => ({
        anchorStatuses: { ...state.anchorStatuses, [artifact.id]: 'missing' },
      }))
      return
    }
    const status = await checkReadingArtifactSource(
      artifact.source,
      loadDocumentContentHashByPath,
    )
    set((state) => ({
      anchorStatuses: { ...state.anchorStatuses, [artifact.id]: status.status },
    }))
  },

  resetAnchorStatus: (id) =>
    set((state) => {
      const next = { ...state.anchorStatuses }
      delete next[id]
      return { anchorStatuses: next }
    }),
}))
