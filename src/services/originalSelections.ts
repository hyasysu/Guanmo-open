import type { ChatMessageTag } from '@/services/ai/types'
import { MAX_SELECTION_CHARS } from '@/types/contextTag'

/** 用户消息 tags 的历史快照；与模型参考来源、引用 ID 分离。 */
export interface OriginalSelectionSnapshot {
  title: string
  text: string
  filePath: string | null
  startLine?: number
  endLine?: number
  selectionFrom?: number
  selectionTo?: number
  truncated: boolean
  previewOnly: boolean
}

function validRange(from: unknown, to: unknown, minimum: number): boolean {
  return typeof from === 'number' && Number.isSafeInteger(from) && from >= minimum
    && typeof to === 'number' && Number.isSafeInteger(to) && to >= from
}

export function buildOriginalSelections(tags: readonly ChatMessageTag[] | undefined): OriginalSelectionSnapshot[] {
  return (tags ?? []).filter((tag) => tag.type === 'selection').flatMap((tag) => {
    const previewOnly = typeof tag.content !== 'string' || !tag.content.length
    const text = previewOnly ? tag.preview : tag.content!
    if (!text) return []
    return [{
      title: tag.title,
      text,
      filePath: tag.filePath,
      ...(validRange(tag.startLine, tag.endLine, 1) ? { startLine: tag.startLine, endLine: tag.endLine } : {}),
      ...(validRange(tag.selectionFrom, tag.selectionTo, 0) ? { selectionFrom: tag.selectionFrom, selectionTo: tag.selectionTo } : {}),
      truncated: previewOnly || text.length > MAX_SELECTION_CHARS || text.includes('...（内容已截断'),
      previewOnly,
    }]
  })
}

/** 旧成果缺字段返回空；可选坐标无效时只保留历史文本。 */
export function decodeOriginalSelections(value: unknown): OriginalSelectionSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const snapshot = item as Record<string, unknown>
    if (typeof snapshot.title !== 'string' || typeof snapshot.text !== 'string' || !snapshot.text
      || typeof snapshot.truncated !== 'boolean' || typeof snapshot.previewOnly !== 'boolean') return []
    return [{
      title: snapshot.title,
      text: snapshot.text,
      filePath: typeof snapshot.filePath === 'string' ? snapshot.filePath : null,
      ...(validRange(snapshot.startLine, snapshot.endLine, 1) ? { startLine: snapshot.startLine as number, endLine: snapshot.endLine as number } : {}),
      ...(validRange(snapshot.selectionFrom, snapshot.selectionTo, 0) ? { selectionFrom: snapshot.selectionFrom as number, selectionTo: snapshot.selectionTo as number } : {}),
      truncated: snapshot.truncated,
      previewOnly: snapshot.previewOnly,
    }]
  })
}
