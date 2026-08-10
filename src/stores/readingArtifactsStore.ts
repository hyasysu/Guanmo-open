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
  type SourceAnchorStatus,
  persistReadingArtifact,
  loadReadingArtifacts,
  deleteReadingArtifact,
  checkReadingArtifactSource,
} from '@/services/database/readingArtifacts'
import { loadDocumentContentHashByPath } from '@/services/database/persistence'

export type ReadingArtifactFilter = ReadingArtifactType | 'all'

interface ReadingArtifactsState {
  artifacts: ReadingArtifact[]
  filter: ReadingArtifactFilter
  loading: boolean
  selectedId: string | null
  /** 已校验的来源锚点状态缓存：artifactId -> status */
  anchorStatuses: Record<string, SourceAnchorStatus>

  loadArtifacts: () => Promise<void>
  setFilter: (filter: ReadingArtifactFilter) => void
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
  /** 类型专属结构化字段，经运行时解码后写入 structured_content */
  structuredContent?: unknown | null
}

function buildAnchorFromSources(
  sources: ChatMessageSource[] | undefined,
  contextScope: ReadingScope | undefined,
  messageId: string | undefined,
): { source: ReadingArtifactSourceAnchor | null; contentHashPromise: Promise<string | undefined> } {
  const localSource = sources?.find((s): s is Extract<ChatMessageSource, { kind?: 'local' }> => s.kind !== 'web')
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

export const useReadingArtifactsStore = create<ReadingArtifactsState>((set, get) => ({
  artifacts: [],
  filter: 'all',
  loading: false,
  selectedId: null,
  anchorStatuses: {},

  loadArtifacts: async () => {
    set({ loading: true })
    try {
      const artifacts = await loadReadingArtifacts({ status: 'active', limit: 500 })
      set({ artifacts, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  setFilter: (filter) => set({ filter }),

  setSelected: (id) => set({ selectedId: id }),

  deleteArtifact: async (id) => {
    await deleteReadingArtifact(id)
    set((state) => ({
      artifacts: state.artifacts.filter((artifact) => artifact.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      anchorStatuses: Object.fromEntries(
        Object.entries(state.anchorStatuses).filter(([key]) => key !== id),
      ),
    }))
  },

  saveArtifactFromMessage: async (input) => {
    const { source, contentHashPromise } = buildAnchorFromSources(
      input.sources,
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
      structuredContent: input.structuredContent ?? null,
      source,
    })
    await get().loadArtifacts()
    return get().artifacts.find((artifact) => artifact.id === id)
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
