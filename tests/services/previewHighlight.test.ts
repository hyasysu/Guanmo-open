import { describe, expect, it } from 'vitest'
import {
  buildDocumentRangeInfo,
  buildDomRangesForSourceRange,
  createSourceOffsetAnnotator,
  collectAnnotatedTextNodes,
  domPointToSourceOffset,
  findWordRangeAt,
  getTextForSourceRange,
} from '@/services/previewHighlight'
import { createMarkdownPreviewModel } from '@/services/markdownPreviewModel'

function renderAnnotated(container: HTMLElement, tree: unknown): void {
  // 最小 HAST → DOM 序列化：仅覆盖测试所需的 element/text 两类节点
  const build = (node: any, parent: Node) => {
    if (node.type === 'text') {
      parent.appendChild(document.createTextNode(node.value))
      return
    }
    const element = document.createElement(node.tagName ?? 'span')
    for (const [key, value] of Object.entries(node.properties ?? {})) {
      element.setAttribute(key.replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`), String(value))
    }
    for (const child of node.children ?? []) build(child, element)
    parent.appendChild(element)
  }
  build(tree, container)
}

describe('previewHighlight 统一 DocumentRange 基础设施', () => {
  it('buildDocumentRangeInfo：全局 offset → 块 ID + 局部 offset', () => {
    const model = createMarkdownPreviewModel('# 标题\n\n第一段文本\n\n第二段文本')
    const firstParagraph = model.blocks.find((b) => b.rawSource.includes('第一段'))
    const secondParagraph = model.blocks.find((b) => b.rawSource.includes('第二段'))
    if (!firstParagraph || !secondParagraph) throw new Error('fixture 解析失败')

    const info = buildDocumentRangeInfo(
      model,
      firstParagraph.startOffset + 3,
      secondParagraph.startOffset + 5,
    )
    if (!info) throw new Error('range 构建失败')
    expect(info.range.startBlockId).toBe(firstParagraph.blockId)
    expect(info.range.startOffset).toBe(3)
    expect(info.range.endBlockId).toBe(secondParagraph.blockId)
    expect(info.range.endOffset).toBe(5)
  })

  it('getTextForSourceRange：跨块提取渲染可见文本，不受 DOM 挂载影响', () => {
    const model = createMarkdownPreviewModel('# 标题\n\n**加粗**文本\n\n第二段内容')
    const first = model.blocks.find((b) => b.rawSource.includes('加粗'))
    const second = model.blocks.find((b) => b.rawSource.includes('第二段'))
    if (!first || !second) throw new Error('fixture 解析失败')

    // 选区覆盖"加粗文本"的后半 + 整个第二段
    const from = first.startOffset + first.rawSource.indexOf('文本')
    const to = second.endOffset
    const text = getTextForSourceRange(model, from, to)
    expect(text).toContain('文本')
    expect(text).toContain('第二段内容')
    expect(text).not.toContain('**')
  })

  it('findWordRangeAt：Unicode 词边界扩展', () => {
    const model = createMarkdownPreviewModel('Hello 观墨世界 Markdown')
    const offset = model.rawContent.indexOf('观墨')
    const word = findWordRangeAt(model, offset + 1)
    if (!word) throw new Error('选词失败')
    expect(model.rawContent.slice(word.from, word.to)).toBe('观墨世界')
  })

  it('annotator：仅标注携带精确 position 的 text，无 position 子树跳过', () => {
    const tree = {
      type: 'element',
      tagName: 'p',
      children: [
        { type: 'text', value: '精确文本', position: { start: { offset: 10 }, end: { offset: 14 } } },
        { type: 'text', value: '重建文本' },
      ],
    }
    const transform = (createSourceOffsetAnnotator(100) as any)()
    transform(tree)
    const first = tree.children[0]
    expect(first.tagName).toBe('span')
    expect(first.properties.dataGmSrcFrom).toBe(110)
    expect(first.properties.dataGmSrcTo).toBe(114)
    // 无 position 的 text（KaTeX/highlight 重建子树）保持原样
    expect(tree.children[1].type).toBe('text')
  })

  it('DOM ↔ 源码 offset：domPointToSourceOffset 与 buildDomRangesForSourceRange 一致', () => {
    const container = document.createElement('div')
    const tree = {
      type: 'element',
      tagName: 'p',
      children: [
        { type: 'text', value: '前文', position: { start: { offset: 0 }, end: { offset: 2 } } },
        { type: 'text', value: '目标文本', position: { start: { offset: 2 }, end: { offset: 6 } } },
        { type: 'text', value: '后文', position: { start: { offset: 6 }, end: { offset: 8 } } },
      ],
    }
    const transform = (createSourceOffsetAnnotator(0) as any)()
    transform(tree)
    renderAnnotated(container, tree)
    document.body.appendChild(container)

    const annotated = collectAnnotatedTextNodes(container)
    expect(annotated).toHaveLength(3)

    // caret → 源码 offset（等长映射）
    const targetNode = annotated[1].node
    expect(domPointToSourceOffset(targetNode, 0)).toBe(2)
    expect(domPointToSourceOffset(targetNode, 4)).toBe(6)
    expect(domPointToSourceOffset(container.firstElementChild!, 0)).toBe(0)

    // 源码区间 → DOM Range（目标区间命中第二段）
    const ranges = buildDomRangesForSourceRange(container, 3, 5)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].startContainer).toBe(targetNode)
    expect(ranges[0].startOffset).toBe(1)
    expect(ranges[0].endOffset).toBe(3)
    document.body.removeChild(container)
  })
})
