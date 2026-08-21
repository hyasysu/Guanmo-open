import { describe, expect, it } from 'vitest'

import {
  createMarkdownPreviewModel,
  getEstimatedPreviewLineForTop,
  getEstimatedPreviewTopForLine,
  type PreviewBlock,
} from '@/services/markdownPreviewModel'

const estimateHeight = (block: PreviewBlock) => Math.max(40, (block.endLine - block.startLine + 1) * 24)

describe('Markdown 预览滚动坐标映射', () => {
  it('使用全文块模型持续反推行号，不依赖当前挂载的虚拟块', () => {
    const content = Array.from({ length: 120 }, (_, index) => (
      `## 小节 ${index + 1}\n\n第 ${index + 1} 段第一行。\n第 ${index + 1} 段第二行。`
    )).join('\n\n')
    const model = createMarkdownPreviewModel(content)
    const sampledLines = [
      model.blocks[0].startLine,
      model.blocks[60].startLine,
      model.blocks[120].startLine,
      model.blocks[180].startLine,
      model.blocks.at(-1)!.endLine,
    ]

    const mapped = sampledLines.map((line) => {
      const top = getEstimatedPreviewTopForLine(model, line, estimateHeight)
      expect(top).toBeTypeOf('number')
      return getEstimatedPreviewLineForTop(model, top!, estimateHeight)
    })

    expect(mapped).toEqual(sampledLines)
    expect(mapped).toEqual([...mapped].sort((left, right) => left! - right!))
  })

  it('使用已测量高度覆盖估算并限制在文档行号范围内', () => {
    const model = createMarkdownPreviewModel('# 标题\n\n第一行\n第二行\n第三行')
    const measured = new Map(model.blocks.map((block, index) => [block.blockId, index === 0 ? 80 : 320]))

    expect(getEstimatedPreviewLineForTop(model, -100, estimateHeight, measured)).toBe(1)
    expect(getEstimatedPreviewLineForTop(model, 240, estimateHeight, measured)).toBeGreaterThan(1)
    expect(getEstimatedPreviewLineForTop(model, 100_000, estimateHeight, measured)).toBe(model.blocks.at(-1)!.endLine)
  })

  it('把块间空白行映射到后续内容，而不是错误落到文档末尾', () => {
    const model = createMarkdownPreviewModel('# 第一节\n\n正文\n\n## 第二节\n\n结尾')
    const gapLine = model.blocks[1].endLine + 1
    const nextBlock = model.blocks.find((block) => block.startLine > gapLine)!
    const gapTop = getEstimatedPreviewTopForLine(model, gapLine, estimateHeight)
    const nextTop = getEstimatedPreviewTopForLine(model, nextBlock.startLine, estimateHeight)
    const documentEndTop = getEstimatedPreviewTopForLine(model, model.blocks.at(-1)!.endLine, estimateHeight)

    expect(gapTop).toBe(nextTop)
    expect(gapTop).toBeLessThan(documentEndTop!)
  })
})
