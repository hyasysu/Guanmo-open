import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'

describe('Markdown 预览列表间距', () => {
  it('嵌套有序列表的简单条目不应带段落外边距', () => {
    const content = [
      '- 推荐理由：',
      '1. test',
      '2. test2',
    ].join('\n')
    const { container } = render(<MarkdownPreview content={content} />)

    const orderedList = container.querySelector('ol') as HTMLOListElement | null
    expect(orderedList).toBeTruthy()
    expect(orderedList?.className).not.toContain('space-y-1')

    const paragraphWrappedItem = orderedList?.querySelector(':scope > li > p') as HTMLParagraphElement | null
    expect(paragraphWrappedItem).toBeNull()
  })

  it('缩进后的有序列表会在父级列表项中产生空白文本节点', () => {
    const content = ['- 推荐理由：', '    1. test', '    2. test2'].join('\n')
    const { container } = render(<MarkdownPreview content={content} />)

    const parentItem = container.querySelector('ul > li')
    expect(parentItem).toBeTruthy()

    const whitespaceTextNode = Array.from(parentItem?.childNodes ?? []).find((node) => (
      node.nodeType === Node.TEXT_NODE && /\s+/.test(node.textContent ?? '')
    ))
    expect(whitespaceTextNode).toBeTruthy()
    expect((parentItem as HTMLLIElement).style.whiteSpace).toBe('normal')
  })
})
