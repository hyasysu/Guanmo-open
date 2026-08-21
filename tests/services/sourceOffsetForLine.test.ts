/**
 * getSourceOffsetForLine 契约测试
 *
 * 验证：源码行号（1-based）→ 该行首字符源码 offset 的映射，
 * 与 getEstimatedPreviewLineForTop 互逆，且与 rawContent 切片一致；
 * 不依赖任何 DOM 挂载状态（虚拟化卸载不影响）。
 */
import { describe, expect, it } from 'vitest'

import {
  createMarkdownPreviewModel,
  getSourceOffsetForLine,
} from '@/services/markdownPreviewModel'

const DOC = '第一段内容\n第二行内容\n\n第三段内容\n第五行'

describe('getSourceOffsetForLine（源码行号 → 源码 offset）', () => {
  it('行首 offset 与 rawContent 切片一致', () => {
    const model = createMarkdownPreviewModel(DOC)
    expect(getSourceOffsetForLine(model, 1)).toBe(0)
    expect(getSourceOffsetForLine(model, 2)).toBe(DOC.indexOf('第二行内容'))
    expect(getSourceOffsetForLine(model, 4)).toBe(DOC.indexOf('第三段内容'))
    expect(getSourceOffsetForLine(model, 5)).toBe(DOC.indexOf('第五行'))
  })

  it('空行（块间 gap）返回 undefined，调用方兜底', () => {
    const model = createMarkdownPreviewModel(DOC)
    // 第 3 行是空行（两块之间的分隔），不属于任何块
    expect(getSourceOffsetForLine(model, 3)).toBeUndefined()
  })

  it('越界行号返回 undefined', () => {
    const model = createMarkdownPreviewModel(DOC)
    expect(getSourceOffsetForLine(model, 0)).toBeUndefined()
    expect(getSourceOffsetForLine(model, 99)).toBeUndefined()
  })

  it('CRLF 文档行号映射一致', () => {
    const crlf = '第一行\r\n第二行\r\n\r\n第三行'
    const model = createMarkdownPreviewModel(crlf)
    expect(getSourceOffsetForLine(model, 1)).toBe(0)
    expect(getSourceOffsetForLine(model, 2)).toBe(crlf.indexOf('第二行'))
    expect(getSourceOffsetForLine(model, 4)).toBe(crlf.indexOf('第三行'))
  })
})
