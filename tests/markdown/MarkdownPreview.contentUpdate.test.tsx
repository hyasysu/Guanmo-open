import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'

function createMeasuredHost() {
  const host = document.createElement('div')
  Object.defineProperties(host, {
    clientHeight: { configurable: true, value: 100 },
    clientWidth: { configurable: true, value: 600 },
    scrollTop: { configurable: true, value: 0, writable: true },
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === host) return new DOMRect(0, 0, 600, 100)
    if (this.classList.contains('gm-markdown-preview')) return new DOMRect(0, 24 - host.scrollTop, 600, 1000)
    const block = this.closest<HTMLElement>('[data-md-block-index]')
    if (block) return new DOMRect(0, 24 + Number.parseFloat(block.style.top || '0') - host.scrollTop, 600, 40)
    return new DOMRect()
  })
  return host
}

const content = Array.from({ length: 80 }, (_, i) => `匿名段落 ${i}`).join('\n\n')

describe('MarkdownPreview 同文档内容刷新', () => {
  it('输入不改变块高度时保留测量值与当前视口，不累计漂移', () => {
    const host = createMeasuredHost()
    const view = render(<MarkdownPreview documentKey="same-document" content={content} />, { container: host })
    act(() => { host.scrollTop = 320; host.dispatchEvent(new Event('scroll')) })
    const anchor = host.querySelector<HTMLElement>('[data-md-block-index="8"]')!
    const before = anchor.getBoundingClientRect().top
    for (let i = 1; i <= 5; i += 1) {
      view.rerender(<MarkdownPreview documentKey="same-document" content={content.replace('匿名段落 8', `匿名段落 8${'x'.repeat(i)}`)} />)
      expect(host.querySelector<HTMLElement>('[data-md-block-index="8"]')!.getBoundingClientRect().top).toBeCloseTo(before, 0)
      expect(host.scrollTop).toBeCloseTo(320, 0)
    }
  })

  it('视口上方插入区块后按同一源码锚点保留屏幕位置', () => {
    const host = createMeasuredHost()
    const view = render(<MarkdownPreview documentKey="same-document" content={content} />, { container: host })
    act(() => { host.scrollTop = 320; host.dispatchEvent(new Event('scroll')) })
    const before = host.querySelector<HTMLElement>('[data-md-block-index="8"]')!.getBoundingClientRect().top
    view.rerender(<MarkdownPreview documentKey="same-document" content={`新增一块\n\n新增另一块\n\n${content}`} />)
    const anchor = [...host.querySelectorAll<HTMLElement>('[data-md-block-index]')].find(el => el.textContent === '匿名段落 8')!
    expect(anchor.getBoundingClientRect().top).toBeCloseTo(before, 0)
  })
})
