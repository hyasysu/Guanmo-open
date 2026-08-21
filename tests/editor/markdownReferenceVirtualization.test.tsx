import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'

describe('Markdown reference virtualization', () => {
  it('resolves cross-block definitions without mounting the whole document', () => {
    const content = [
      '[首屏引用][guide]',
      ...Array.from({ length: 300 }, (_, index) => `\n\n段落 ${index} 的匿名填充内容。`),
      '',
      '[guide]: https://example.com/guide "Guide"',
    ].join('\n')
    const view = render(<MarkdownPreview content={content} />)
    const link = view.getByRole('link', { name: '首屏引用' })
    expect(link).toHaveAttribute('href', 'https://example.com/guide')
    expect(view.container.querySelectorAll('[data-md-block-index]').length).toBeLessThan(40)
  })

  it('renders cross-block footnotes and navigates in both directions', () => {
    const content = [
      '正文脚注[^note]。',
      '',
      '第二段也引用[^note]。',
      ...Array.from({ length: 300 }, (_, index) => `\n\n段落 ${index} 的匿名填充内容。`),
      '',
      '[^note]: 脚注定义内容。',
    ].join('\n')
    const view = render(<MarkdownPreview content={content} />)
    const footnoteSection = view.container.querySelector<HTMLElement>('section[data-footnotes]')
    expect(footnoteSection).not.toBeNull()
    expect(footnoteSection).toHaveTextContent('脚注定义内容。')
    expect(view.container.querySelectorAll('section[data-footnotes]')).toHaveLength(1)
    expect(view.container.querySelectorAll('a[data-footnote-backref]')).toHaveLength(2)
    const referenceIds = [...view.container.querySelectorAll('sup a[data-footnote-ref]')].map((item) => item.id)
    expect(new Set(referenceIds).size).toBe(referenceIds.length)

    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    const reference = view.container.querySelector<HTMLAnchorElement>('[data-md-block-index] sup a[href="#user-content-fn-note"]')
    expect(reference).not.toBeNull()
    fireEvent.click(reference!)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })

    view.container.querySelectorAll('[data-md-block-index] sup a[data-footnote-ref]').forEach((item) => item.remove())
    const scrollTo = vi.fn()
    const preview = view.container.querySelector<HTMLElement>('.gm-markdown-preview')
    Object.defineProperty(preview!.parentElement!, 'scrollTo', { configurable: true, value: scrollTo })
    const backref = view.container.querySelectorAll<HTMLAnchorElement>('a[data-footnote-backref]')[1]
    expect(backref).toHaveAttribute('href', '#user-content-fnref-note-2')
    fireEvent.click(backref!)
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
    expect(view.container.querySelectorAll('[data-md-block-index]').length).toBeLessThan(40)
  })

  it('virtualizes self-contained HTML but keeps cross-block HTML compatible', async () => {
    const selfContained = ['<span data-safe="true">安全 HTML</span>', ...Array.from({ length: 300 }, (_, index) => `\n\n段落 ${index}。`)].join('\n')
    const virtualized = render(<MarkdownPreview content={selfContained} />)
    await vi.waitFor(() => expect(virtualized.container.querySelector('[data-md-block-index]')).not.toBeNull())
    expect(virtualized.container.querySelectorAll('[data-md-block-index]').length).toBeLessThan(40)
    virtualized.unmount()

    const crossBlock = ['开始 <span data-cross="true">', '', '跨块正文', '', '结束</span>'].join('\n')
    const compatible = render(<MarkdownPreview content={crossBlock} />)
    await vi.waitFor(() => expect(compatible.container.querySelector('.gm-markdown-preview')).toHaveAttribute('data-md-render-mode', 'whole'))
  })
})
