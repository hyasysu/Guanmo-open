/**
 * 选区 → AI 上下文输入边界契约测试
 *
 * 验证 docs/architecture/state-ownership.md 第 4/6/7 节 Invariants：
 * - 预览模型的 offset 坐标系与 Tab.content 是同一坐标系（model.rawContent 即输入内容），
 *   DocumentRange 基础设施产出的源码 offset 可直接用于 content.slice 精确提取。
 * - 跨块源码选区进入 AI contextTag 全程基于文档模型，不依赖任何 DOM 挂载
 *   （EditorArea.getPreviewSourceSelection 的精确路径）。
 * - 超长选区截断 content 但保留精确 offset（供后端按 Range 重读全文）。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { addSelectionContextTag } from '@/services/aiContext'
import { createMarkdownPreviewModel } from '@/services/markdownPreviewModel'
import { buildDocumentRangeInfo } from '@/services/previewHighlight'
import { useChatStore } from '@/stores/chatStore'
import { MAX_SELECTION_CHARS } from '@/types/contextTag'

describe('选区 → AI 上下文输入边界契约（invariants 见 docs/architecture/state-ownership.md）', () => {
  beforeEach(() => {
    useChatStore.getState().clearContextTags()
  })

  it('预览模型 offset 坐标系与 Tab 内容一致（rawContent 即输入内容）', () => {
    const content = '第一段内容\n\n**加粗**文本\n\n# 标题\n\n正文'
    const model = createMarkdownPreviewModel(content)
    expect(model.rawContent).toBe(content)
  })

  it('跨块源码选区经模型坐标进入 AI 上下文，全程不依赖 DOM 挂载', () => {
    const content = '第一段内容\n\n第二段内容\n\n第三段内容'
    const model = createMarkdownPreviewModel(content)

    // DocumentRange 基础设施产出的源码 offset（拖选经 data-gm-src 标注映射得到）
    const from = content.indexOf('一')
    const to = content.length
    const info = buildDocumentRangeInfo(model, from, to)
    if (!info) throw new Error('DocumentRange 构建失败')
    expect(info.startLine).toBe(1)
    expect(info.endLine).toBe(5)

    // getPreviewSourceSelection 的精确路径：content.slice(from, to)
    const text = content.slice(from, to)
    addSelectionContextTag({
      title: '匿名文档.md',
      filePath: 'X:\\anon\\doc.md',
      text,
      startLine: info.startLine,
      endLine: info.endLine,
      selectionFrom: from,
      selectionTo: to,
    })

    const tag = useChatStore.getState().contextTags[0]
    if (!tag) throw new Error('contextTag 未创建')
    expect(tag.type).toBe('selection')
    expect(tag.content).toBe(text)
    expect(tag.selectionFrom).toBe(from)
    expect(tag.selectionTo).toBe(to)
  })

  it('超长选区截断 content 但保留精确 offset（后端可按 Range 重读全文）', () => {
    const filler = '这是一段用于填充长度的匿名文本。'
    const content = Array.from({ length: 300 }, () => filler).join('\n\n')
    expect(content.length).toBeGreaterThan(MAX_SELECTION_CHARS)

    addSelectionContextTag({
      title: '匿名长文档.md',
      filePath: 'X:\\anon\\long.md',
      text: content,
      selectionFrom: 0,
      selectionTo: content.length,
    })

    const tag = useChatStore.getState().contextTags[0]
    if (!tag?.content) throw new Error('contextTag 未创建')
    expect(tag.content.startsWith(content.slice(0, MAX_SELECTION_CHARS))).toBe(true)
    expect(tag.content).toContain('内容已截断')
    expect(tag.selectionFrom).toBe(0)
    expect(tag.selectionTo).toBe(content.length)
  })
})
