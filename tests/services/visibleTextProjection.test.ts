/**
 * 可见文本投影契约测试（阶段 1：全文可见文本与搜索语义修复）
 *
 * 验证：
 * - 逻辑全文复制（getTextForSourceRange）包含行内数学、块级数学与安全 HTML
 *   的确定回退文本，不再静默遗漏；跨块选区顺序稳定且无重复。
 * - math / html 的 segment 与源码逐字符对齐（rawContent.slice(from,to) === text）。
 * - 搜索域 = 复制域：searchVisibleText 只命中可见文本投影；
 *   链接 URL、Markdown 标记、HTML 标签不产生无可见反馈的幽灵结果；
 *   每个命中可映射回原始 offset 与真实块。
 * - LF 与 CRLF 行尾语义一致。
 * - 投影随模型实例缓存；模型重建后旧投影不串扰（可重建派生索引）。
 */
import { describe, expect, it } from 'vitest'

import {
  createMarkdownPreviewModel,
  getVisibleTextProjection,
  searchVisibleText,
  type MarkdownPreviewModel,
} from '@/services/markdownPreviewModel'
import { getTextForSourceRange } from '@/services/previewHighlight'

/** 数学 / html segment 必须与源码逐字符对齐 */
function expectSegmentsAligned(model: MarkdownPreviewModel): void {
  for (const block of model.blocks) {
    for (const segment of block.textSegments) {
      expect(model.rawContent.slice(segment.from, segment.to)).toBe(segment.text)
    }
  }
}

describe('可见文本投影：数学与安全 HTML 提取（缺陷 1 复现）', () => {
  const DOC = 'alpha $x^2$ omega\n\n$$\nE=mc^2\n$$\n\n<div>visible html</div>\n\nbravo tail'

  it('逻辑全文复制包含行内数学、块级数学与安全 HTML 文本', () => {
    const model = createMarkdownPreviewModel(DOC)
    const text = getTextForSourceRange(model, 0, DOC.length)
    expect(text).toContain('alpha')
    expect(text).toContain('x^2')
    expect(text).toContain('omega')
    expect(text).toContain('E=mc^2')
    expect(text).toContain('visible html')
    expect(text).toContain('bravo tail')
  })

  it('跨块选区顺序稳定且无重复（精确串断言）', () => {
    const model = createMarkdownPreviewModel(DOC)
    const text = getTextForSourceRange(model, 0, DOC.length)
    expect(text).toBe('alpha x^2 omega\n\nE=mc^2\n\nvisible html\n\nbravo tail')
  })

  it('数学 / html segment 与源码逐字符对齐', () => {
    const model = createMarkdownPreviewModel(DOC)
    expectSegmentsAligned(model)
    const mathInline = model.blocks.flatMap((b) => b.textSegments).find((s) => s.text === 'x^2')
    expect(mathInline).toBeDefined()
    const mathBlock = model.blocks.flatMap((b) => b.textSegments).find((s) => s.text === 'E=mc^2')
    expect(mathBlock).toBeDefined()
    const htmlRun = model.blocks.flatMap((b) => b.textSegments).find((s) => s.text === 'visible html')
    expect(htmlRun).toBeDefined()
  })

  it('选区从公式中间开始时按字符对齐切片', () => {
    const model = createMarkdownPreviewModel(DOC)
    const mathBlock = model.blocks.flatMap((b) => b.textSegments).find((s) => s.text === 'E=mc^2')!
    // 从 '=mc' 开始截取到公式结尾
    const from = mathBlock.from + 1
    const text = getTextForSourceRange(model, from, mathBlock.to)
    expect(text).toBe('=mc^2')
  })

  it('嵌套标签 HTML 只提取文本 run，属性与标签不进入投影', () => {
    const doc = '<div title="attrSecret">a<span>b</span>c</div>'
    const model = createMarkdownPreviewModel(doc)
    const text = getTextForSourceRange(model, 0, doc.length)
    expect(text).toBe('abc')
    expect(text).not.toContain('attrSecret')
    expectSegmentsAligned(model)
  })

  it('script / style / foreignObject 内部文本不产生 segment', () => {
    const doc = [
      '<div>keep me</div>',
      '',
      '<script>var secretScript = 1</script>',
      '',
      '<style>.secretStyle { color: red }</style>',
      '',
      '<svg><foreignObject><div>secretForeign</div></foreignObject></svg>',
    ].join('\n')
    const model = createMarkdownPreviewModel(doc)
    const text = getTextForSourceRange(model, 0, doc.length)
    expect(text).toContain('keep me')
    expect(text).not.toContain('secretScript')
    expect(text).not.toContain('secretStyle')
    expect(text).not.toContain('secretForeign')
  })
})

describe('可见文本投影：搜索语义统一（缺陷 6 复现）', () => {
  const DOC = [
    '看这个 [链接标签](https://ghost.example.com/hidden) 结尾',
    '',
    '**加粗文本**正文',
    '',
    '# 标题章节',
    '',
    '公式 alpha $x^2$ omega 与块级',
    '',
    '$$',
    'E=mc^2',
    '$$',
    '',
    '<div class="tagSecret">html 可见文本</div>',
    '',
    '```js',
    'const codeSecret = 1',
    '```',
  ].join('\n')

  it('命中可见文本（普通文本 / 数学回退 / HTML run / 代码内容）', () => {
    const model = createMarkdownPreviewModel(DOC)
    for (const query of ['链接标签', '加粗文本', '正文', '标题章节', 'x^2', 'E=mc^2', 'html 可见文本', 'codeSecret']) {
      const hits = searchVisibleText(model, query)
      expect(hits.length, `query=${query}`).toBeGreaterThanOrEqual(1)
      for (const hit of hits) {
        const block = model.blocks[hit.blockIndex]
        expect(block).toBeDefined()
        expect(hit.from).toBeGreaterThanOrEqual(block.startOffset)
        expect(hit.to).toBeLessThanOrEqual(block.endOffset)
      }
    }
  })

  it('行内代码、围栏代码与缩进代码命中返回精确源码 offset', () => {
    const doc = [
      'before `inlineSecret` after',
      '',
      'literal `` ` `` marker',
      '',
      '```ts',
      'const fencedSecret = 1',
      '```',
      '',
      '    const indentedSecret = 2',
    ].join('\n')
    const model = createMarkdownPreviewModel(doc)
    for (const query of ['inlineSecret', '`', 'fencedSecret', 'indentedSecret']) {
      const [hit] = searchVisibleText(model, query)
      expect(hit, `query=${query}`).toBeDefined()
      expect(model.rawContent.slice(hit.from, hit.to), `query=${query}`).toBe(query)
    }
  })

  it('CRLF 多行围栏代码的第二行命中返回精确源码 offset', () => {
    const doc = '```ts\r\nconst firstLine = 1\r\nconst crlfSecret = 2\r\n```'
    const model = createMarkdownPreviewModel(doc)
    const [hit] = searchVisibleText(model, 'crlfSecret')
    expect(hit).toBeDefined()
    expect(model.rawContent.slice(hit.from, hit.to)).toBe('crlfSecret')
    expect(getTextForSourceRange(model, 0, doc.length)).toBe('const firstLine = 1\r\nconst crlfSecret = 2')
  })

  it('链接 URL、Markdown 标记、HTML 标签不产生幽灵结果', () => {
    const model = createMarkdownPreviewModel(DOC)
    for (const query of ['https://ghost.example.com', 'hidden', '**', '](https', '#', 'class=', 'tagSecret', '```', 'div']) {
      const hits = searchVisibleText(model, query)
      expect(hits, `query=${query}`).toHaveLength(0)
    }
  })

  it('搜索域与复制域一致：投影全文等于 getTextForSourceRange 全文', () => {
    const model = createMarkdownPreviewModel(DOC)
    const projection = getVisibleTextProjection(model)
    expect(projection.text).toBe(getTextForSourceRange(model, 0, DOC.length))
  })

  it('投影随模型实例缓存；模型重建后投影独立（派生可重建）', () => {
    const modelA = createMarkdownPreviewModel('文档甲 $a^2$')
    const modelB = createMarkdownPreviewModel('文档乙 $b^2$')
    expect(getVisibleTextProjection(modelA)).toBe(getVisibleTextProjection(modelA))
    expect(getVisibleTextProjection(modelA).text).not.toBe(getVisibleTextProjection(modelB).text)
    expect(getVisibleTextProjection(modelB).text).toContain('b^2')
  })

  it('未挂载概念：命中不依赖块顺序之外的任何 DOM 状态（blockIndex 均有效）', () => {
    // 构造大量填充块，验证远端命中仍返回有效块索引与 offset
    const parts: string[] = ['开头 needle 一次']
    for (let i = 0; i < 200; i += 1) parts.push(`\n\n填充段落 ${i} 内容。`)
    parts.push('\n\n结尾 needle 二次')
    const model = createMarkdownPreviewModel(parts.join(''))
    const hits = searchVisibleText(model, 'needle')
    expect(hits).toHaveLength(2)
    expect(model.blocks[hits[0].blockIndex].rawSource).toContain('开头')
    expect(model.blocks[hits[1].blockIndex].rawSource).toContain('结尾')
    expect(model.rawContent.slice(hits[0].from, hits[0].to)).toBe('needle')
  })
})

describe('可见文本投影：CRLF 行尾', () => {
  const DOC = 'first\r\n\r\nalpha $x^2$ omega\r\n\r\n$$\r\nE=mc^2\r\n$$\r\n\r\n<div>html text</div>'

  it('CRLF 下数学 / html segment 仍与源码逐字符对齐', () => {
    const model = createMarkdownPreviewModel(DOC)
    expectSegmentsAligned(model)
    const segments = model.blocks.flatMap((b) => b.textSegments).map((s) => s.text)
    expect(segments).toContain('x^2')
    expect(segments).toContain('E=mc^2')
    expect(segments).toContain('html text')
  })

  it('CRLF 下全文复制与搜索语义与 LF 一致', () => {
    const model = createMarkdownPreviewModel(DOC)
    const text = getTextForSourceRange(model, 0, DOC.length)
    expect(text).toContain('x^2')
    expect(text).toContain('E=mc^2')
    expect(text).toContain('html text')
    expect(searchVisibleText(model, 'E=mc^2')).toHaveLength(1)
    expect(searchVisibleText(model, 'html text')).toHaveLength(1)
    expect(searchVisibleText(model, '<div>')).toHaveLength(0)
  })
})
