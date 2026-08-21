/**
 * DocumentRange 契约测试
 *
 * 验证 docs/architecture/state-ownership.md 第 4/6 节 Invariants：
 * - DocumentRange 坐标系与原始 Markdown 源码一致：块内任意 offset 区间的
 *   getTextForSourceRange 结果等于 rawContent 对应切片（纯文本段落下）。
 * - 同一 offset 区间映射结果确定，且 blockId 引用模型中真实存在的块。
 * - 块间隙 offset 收敛到相邻块，不产生越界局部 offset。
 *
 * 以上全部基于文档模型计算，不依赖任何 DOM 挂载状态（虚拟化卸载不影响）。
 */
import { describe, expect, it } from 'vitest'

import {
  buildDocumentRangeInfo,
  getTextForSourceRange,
} from '@/services/previewHighlight'
import { createMarkdownPreviewModel } from '@/services/markdownPreviewModel'

const DOC = '第一段内容\n\n第二段内容\n\n第三段内容'

describe('DocumentRange 契约（invariants 见 docs/architecture/state-ownership.md）', () => {
  const model = createMarkdownPreviewModel(DOC)

  /** 全部位于块内容范围内的 offset（排除块间空行 gap） */
  const inBlockOffsets: number[] = []
  for (const block of model.blocks) {
    for (let offset = block.startOffset; offset < block.endOffset; offset += 1) {
      inBlockOffsets.push(offset)
    }
  }

  it('块内任意 offset 区间的文本提取等于源码对应切片（坐标系一致）', () => {
    expect(model.blocks.length).toBeGreaterThanOrEqual(3)

    // 穷举 offset 对：起点在块内，终点满足 to-1 在块内（即不含边缘 gap）；
    // 验证模型坐标系与源码一一对应，块间分隔由 join 以 '\n\n' 还原。
    const validTo = [...new Set(inBlockOffsets.map((offset) => offset + 1))]
    for (const from of inBlockOffsets) {
      for (const to of validTo) {
        if (to <= from) continue
        expect(getTextForSourceRange(model, from, to)).toBe(DOC.slice(from, to))
      }
    }
  })

  it('范围边缘的块间隙不计入提取文本（渲染可见文本语义）', () => {
    // from 落在块间空行：提取从下一个实际贡献文本的块开始
    const fromGap = DOC.indexOf('\n')
    const toEnd = DOC.indexOf('第二段内容') + '第二段内容'.length
    expect(getTextForSourceRange(model, fromGap, toEnd)).toBe('第二段内容')
  })

  it('同一 offset 区间映射结果确定，blockId 引用真实存在的块', () => {
    const blockIds = new Set(model.blocks.map((block) => block.blockId))
    const from = DOC.indexOf('二')
    const to = DOC.indexOf('第三段') + '第三段'.length

    const first = buildDocumentRangeInfo(model, from, to)
    const second = buildDocumentRangeInfo(model, from, to)

    expect(first).not.toBeNull()
    expect(second).toEqual(first)
    expect(blockIds.has(first!.range.startBlockId)).toBe(true)
    expect(blockIds.has(first!.range.endBlockId)).toBe(true)
  })

  it('块间隙 offset 收敛到相邻块，不产生越界局部 offset', () => {
    const gaps: number[] = []
    for (let offset = 0; offset < DOC.length; offset += 1) {
      const inside = model.blocks.some(
        (block) => offset >= block.startOffset && offset < block.endOffset,
      )
      if (!inside) gaps.push(offset)
    }
    expect(gaps.length).toBeGreaterThan(0)

    for (const gap of gaps) {
      const info = buildDocumentRangeInfo(model, gap, DOC.length)
      expect(info).not.toBeNull()
      const startBlock = model.blocks.find((block) => block.blockId === info!.range.startBlockId)
      expect(startBlock).toBeDefined()
      expect(info!.range.startOffset).toBeGreaterThanOrEqual(0)
      expect(info!.range.startOffset).toBeLessThanOrEqual(startBlock!.endOffset - startBlock!.startOffset)
    }
  })
})
