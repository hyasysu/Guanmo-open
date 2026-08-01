/**
 * 阶段2原型：交互能力定向验证（tests/ 下，复用默认 vitest include）
 *
 * 覆盖：
 * - 目录跳转到尚未挂载块（virtualize=true）
 * - 滚动同步当前锚点行号
 * - 搜索能命中未挂载块（基于全文文本，不依赖当前 DOM）
 * - 预览内编辑可得到精确原始 offset（基于块 startOffset 与行）
 * - 任务列表点击返回正确原始行号
 */

import { describe, it, expect } from 'vitest'
import React, { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  createMarkdownPreviewModel,
  findBlockIndexByOffset,
  findBlockIndexByLine,
  searchContent,
} from '@/services/markdownPreviewModel'
import {
  PrototypeMarkdownPreview,
  currentSyncAnchor,
  scrollToLine,
  searchPreview,
} from '@scripts/markdown-preview-prototype/PrototypeMarkdownPreview'
import { generateAnonymousMarkdown } from '@scripts/markdown-preview-prototype/generateBenchmarkDoc'

function makeLongStructuredDoc(): string {
  const parts: string[] = []
  for (let i = 1; i <= 40; i += 1) {
    parts.push(`# 第 ${i} 章 H-line-${i}-anchor\n\n`)
    for (let j = 0; j < 20; j += 1) {
      parts.push(`段落内容 P${i}-${j}：这是一段中文与 English 混合内容，作为填充。\n\n`)
    }
  }
  return parts.join('')
}

describe('stage-2 | model primitives for interaction', () => {
  it('findBlockIndexByLine / findBlockIndexByOffset 命中未挂载块', () => {
    const doc = generateAnonymousMarkdown(200_000, 11)
    const model = createMarkdownPreviewModel(doc.markdown)
    const last = model.blocks[model.blocks.length - 1]
    if (!last) throw new Error('无块')
    // 选一个接近中间的具体块，避免总行数估计偏差
    const midBlockIndex = Math.min(model.blocks.length - 2, Math.floor(model.blocks.length * 0.5))
    const probe = model.blocks[midBlockIndex]!
    const midLine = probe.startLine
    const midIdx = findBlockIndexByLine(model, midLine)
    expect(midIdx).toBeGreaterThanOrEqual(Math.floor(model.blocks.length * 0.3))
    expect(midIdx).toBeLessThan(model.blocks.length)

    const offIdx = findBlockIndexByOffset(model, probe.startOffset + 12)
    expect(offIdx).toBeGreaterThanOrEqual(0)
  })

  it('searchContent 基于全文，不依赖当前 DOM 挂载', () => {
    let md = [
      '# 开头章节',
      '',
      '普通段落里有一个隐藏关键词：abcXYZ123。',
      '',
      '# 结尾章节',
    ].join('\n')
    for (let i = 0; i < 1000; i += 1) {
      md += `\n\n段落 filler-${i} 内容内容内容。`
    }
    const model = createMarkdownPreviewModel(md)
    const hits = searchContent(model, 'abcXYZ123', 10)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    const first = hits[0]!
    expect(first.line).toBeGreaterThan(0)
    expect(first.blockIndex).toBeGreaterThanOrEqual(0)
    expect(first.snippet).toContain('abcXYZ123')
  })
})

describe('stage-2 | PrototypeMarkdownPreview interaction primitives', () => {
  it('heading click 回调返回原始行号（virtualize 模式）', () => {
    const md = makeLongStructuredDoc()
    const model = createMarkdownPreviewModel(md)
    const headingLines: number[] = []
    render(
      React.createElement(PrototypeMarkdownPreview, {
        content: md,
        virtualize: true,
        onHeadingClick: (line) => headingLines.push(line),
      }),
    )
    const firstHeading = screen.getAllByRole('heading', { level: 1 })[0]
    expect(firstHeading).not.toBeUndefined()
    act(() => {
      fireEvent.click(firstHeading)
    })
    expect(headingLines.length).toBeGreaterThan(0)
    const line = headingLines[0]!
    expect(line).toBeGreaterThanOrEqual(1)
    expect(findBlockIndexByLine(model, line)).toBeGreaterThanOrEqual(0)
  })

  it('任务列表 toggle 回调返回原始行号', () => {
    const md = [
      '# 任务',
      '',
      '- [ ] 未完成任务 A（line-3）',
      '- [x] 已完成任务 B（line-4）',
      '',
      '继续文本填充'.repeat(30),
    ].join('\n')
    const toggled: Array<{ line: number; checked: boolean }> = []
    render(
      React.createElement(PrototypeMarkdownPreview, {
        content: md,
        virtualize: false,
        onTaskToggle: (line, checked) => toggled.push({ line, checked }),
      }),
    )
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.length).toBe(2)
    act(() => {
      fireEvent.click(boxes[0]!)
    })
    expect(toggled.length).toBe(1)
    expect(toggled[0]!.line).toBeGreaterThanOrEqual(3)
    expect(toggled[0]!.checked).toBe(true)
  })

  it('scrollToLine 能对尚未挂载块设置滚动（virtualize 模式）', () => {
    const md = makeLongStructuredDoc()
    const model = createMarkdownPreviewModel(md)
    const { container } = render(
      React.createElement(PrototypeMarkdownPreview, {
        content: md,
        virtualize: true,
      }),
    )
    const targetBlock = model.blocks[Math.floor(model.blocks.length * 0.7)]
    expect(targetBlock).not.toBeUndefined()
    const line = targetBlock!.startLine
    const ok = scrollToLine(container as HTMLElement, line, model)
    expect(ok).toBe(true)
    const scroller = screen.getByTestId('prototype-scroll-container') as HTMLDivElement
    expect(scroller.scrollTop).toBeGreaterThan(10)
  })

  it('currentSyncAnchor 返回可视区首块行号（用于滚动同步）', () => {
    const md = makeLongStructuredDoc()
    const model = createMarkdownPreviewModel(md)
    const { container } = render(
      React.createElement(PrototypeMarkdownPreview, {
        content: md,
        virtualize: true,
      }),
    )
    const anchor = currentSyncAnchor(container as HTMLElement, model)
    expect(typeof anchor).toBe('number')
    expect(anchor).toBeLessThanOrEqual(30)
  })

  it('searchPreview 与 searchContent 一致', () => {
    let md = '# 开头\n\n这是搜索目标 QWERTY_abc。\n\n'
    for (let i = 0; i < 600; i += 1) md += `段落 ${i} 填充填充填充。\n\n`
    const model = createMarkdownPreviewModel(md)
    const hits = searchPreview(model, 'QWERTY_abc')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('块 offset 与 line 保持一致（预览内编辑的根假设）', () => {
    const md = [
      '# P1',
      '',
      '第一段：line-3 offset 起点。',
      '',
      '第二段：line-5 的内容，这里有 Alt+点击目标。',
    ].join('\n')
    const model = createMarkdownPreviewModel(md)
    const blocks = model.blocks.filter((b) => b.type === 'paragraph')
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    const p2 = blocks[1]!
    expect(p2.endOffset).toBeGreaterThan(p2.startOffset)
    const back = findBlockIndexByOffset(model, p2.startOffset + 5)
    expect(model.blocks[back]?.blockId).toBe(p2.blockId)
  })

  it('等长 LaTeX 规范化后仍精确保留 CRLF 原文切片', () => {
    const md = '\uFEFF# 标题\r\n\r\n\\[\r\nx + y\r\n\\]\r\n\r\n尾段'
    const model = createMarkdownPreviewModel(md)

    expect(model.normalizedContent).toHaveLength(md.length)
    for (const block of model.blocks) {
      expect(block.rawSource).toBe(md.slice(block.startOffset, block.endOffset))
    }
  })
})
