import { describe, expect, it } from 'vitest'
import { buildOriginalSelections, decodeOriginalSelections } from '@/services/originalSelections'
import { buildChatMessageTags } from '@/services/aiChatMessages'
import type { ContextTag } from '@/types/contextTag'

const tag: ContextTag = {
  id: 'selection-1', type: 'selection', title: '匿名选区', filePath: 'C:/anonymous/A.md',
  content: '  当轮原文\n第二行  ', preview: '当轮原文', startLine: 2, endLine: 3, selectionFrom: 4, selectionTo: 18,
}

describe('original selection snapshots', () => {
  it('preserves exact text and each selection through the existing user-message tags', () => {
    const snapshots = buildOriginalSelections(buildChatMessageTags([tag, { ...tag, id: 'selection-2', content: '另一区块', startLine: 8, endLine: 8 }]))
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]).toEqual({ title: tag.title, text: tag.content, filePath: tag.filePath,
      startLine: 2, endLine: 3, selectionFrom: 4, selectionTo: 18, truncated: false, previewOnly: false })
    expect(decodeOriginalSelections(JSON.parse(JSON.stringify(snapshots)))).toEqual(snapshots)
  })
  it('retains pathless text and marks the known 4000-character truncation instead of reading a current file', () => {
    const snapshots = buildOriginalSelections(buildChatMessageTags([{ ...tag, filePath: null, content: `${'文'.repeat(4000)}\n\n...（内容已截断，共 6000 字符）` }]))
    expect(snapshots[0]).toMatchObject({ filePath: null, truncated: true, previewOnly: false, selectionFrom: 4, selectionTo: 18 })
  })
  it('marks preview fallback and drops invalid coordinates without losing text', () => {
    const snapshots = buildOriginalSelections(buildChatMessageTags([{ ...tag, content: null, startLine: -1, endLine: 3, selectionFrom: 20, selectionTo: 2 }]))
    expect(snapshots).toEqual([{ title: tag.title, text: tag.preview, filePath: tag.filePath, truncated: true, previewOnly: true }])
  })
  it('reads old or malformed optional metadata without inventing selections', () => {
    expect(decodeOriginalSelections(undefined)).toEqual([])
    expect(decodeOriginalSelections([{ text: '不完整' }, null])).toEqual([])
    expect(buildOriginalSelections(buildChatMessageTags([{ ...tag, type: 'file', content: null }]))).toEqual([])
  })
})
