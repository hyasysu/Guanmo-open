import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'

/**
 * 页内锚点跳转（阶段 2：模型驱动锚点定位）
 *
 * 覆盖：
 * - 目标位于虚拟窗口外（下方远端）：先按全文模型估算定位，目标挂载测量后
 *   由 pending 校正 effect 完成一次幂等精对齐，且不形成滚动反馈循环；
 * - 锚点不存在：安全 no-op（不改滚动、不改 URL hash）；
 * - 目标已挂载：标题 slug 走平滑滚动；heading-{line} 内部 id 走 scrollIntoView。
 */

const VIEWPORT_HEIGHT = 800
const VIEWPORT_WIDTH = 600

// 与 estimatePreviewBlockHeight（fontSize=14、lineHeight=1.65）的单行段落估算值
// 故意不同：让“估算定位 → 实测校正”路径真实发生，而不是估算恰好等于实测。
const MEASURED_PARAGRAPH_HEIGHT = 60
const MEASURED_HEADING_HEIGHT = 80

function makeRect(top: number, height: number) {
  return {
    x: 0,
    y: top,
    width: VIEWPORT_WIDTH,
    height,
    top,
    right: VIEWPORT_WIDTH,
    bottom: top + height,
    left: 0,
    toJSON: () => ({}),
  }
}

function createScrollHost() {
  const host = document.createElement('div')
  let currentScrollTop = 0
  const scrollTopWrites: number[] = []
  const scrollToCalls: Array<ScrollToOptions | undefined> = []

  Object.defineProperties(host, {
    clientHeight: { configurable: true, get: () => VIEWPORT_HEIGHT },
    clientWidth: { configurable: true, get: () => VIEWPORT_WIDTH },
    scrollTop: {
      configurable: true,
      get: () => currentScrollTop,
      set: (value: number) => {
        currentScrollTop = value
        scrollTopWrites.push(value)
      },
    },
    scrollTo: {
      configurable: true,
      writable: true,
      value: (options?: ScrollToOptions) => {
        scrollToCalls.push(options)
        if (options && typeof options.top === 'number') {
          host.scrollTop = options.top
          host.dispatchEvent(new Event('scroll'))
        }
      },
    },
  })

  return { host, scrollToCalls, scrollTopWrites }
}

function installRectMock(host: HTMLElement) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const anchor = this.closest<HTMLElement>('[data-md-block-index]')
    if (!anchor) return makeRect(0, 0)
    const absTop = Number.parseFloat(anchor.style.top) || 0
    const height = anchor.dataset.mdBlockType === 'heading'
      ? MEASURED_HEADING_HEIGHT
      : MEASURED_PARAGRAPH_HEIGHT
    // 模拟真实滚动几何：rect.top 为视口相对坐标
    return makeRect(absTop - host.scrollTop, height)
  })
}

function installScrollIntoViewStub() {
  const scrollIntoView = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  })
  return scrollIntoView
}

const flushFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('MarkdownPreview 页内锚点（模型驱动定位）', () => {
  it('目标位于虚拟窗口外时按模型估算跳转，挂载测量后完成一次校正并稳定', async () => {
    const { host, scrollToCalls, scrollTopWrites } = createScrollHost()
    installRectMock(host)
    installScrollIntoViewStub()

    const content = [
      '[跳转远端](#far-target-section)',
      ...Array.from({ length: 40 }, (_, index) => `\n\n远端测试段落 ${index + 1} 的匿名填充内容。`),
      '\n\n## Far Target Section',
    ].join('')
    const view = render(<MarkdownPreview content={content} />, { container: host })

    // 初始虚拟窗口不包含远端标题
    expect(host.querySelector('[data-md-block-type="heading"]')).toBeNull()
    expect(view.container.querySelectorAll('[data-md-block-index]').length).toBeLessThan(40)

    await act(async () => {
      fireEvent.click(view.getByRole('link', { name: '跳转远端' }))
    })

    // 模型估算定位：一次即时 scrollTo（不带 smooth），目标位置在文档远端
    expect(scrollToCalls).toHaveLength(1)
    expect(scrollToCalls[0]?.top).toBeGreaterThan(2000)
    expect(scrollToCalls[0]?.behavior).toBeUndefined()

    // 目标块已挂载
    const heading = host.querySelector<HTMLElement>('[data-md-block-type="heading"]')
    expect(heading).not.toBeNull()
    expect(heading).toHaveTextContent('Far Target Section')

    // URL hash 已同步
    expect(window.location.hash).toBe('#far-target-section')

    // 估算与实测不一致触发了锚点补偿/单次校正的 scrollTop 写入
    expect(scrollTopWrites.length).toBeGreaterThan(1)

    // 稳定后不再产生滚动写入：无滚动反馈循环
    const writesAfterStabilization = scrollTopWrites.length
    await flushFrame()
    await flushFrame()
    expect(scrollTopWrites.length).toBe(writesAfterStabilization)
  })

  it('锚点不存在时保持安全 no-op：不滚动、不更新 hash', async () => {
    const { host, scrollToCalls, scrollTopWrites } = createScrollHost()
    installRectMock(host)
    const scrollIntoView = installScrollIntoViewStub()

    const view = render(<MarkdownPreview content={'[失效锚点](#does-not-exist)\n\n正文段落内容。'} />, { container: host })

    await act(async () => {
      fireEvent.click(view.getByRole('link', { name: '失效锚点' }))
    })

    expect(scrollToCalls).toHaveLength(0)
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(scrollTopWrites).toHaveLength(0)
    expect(host.scrollTop).toBe(0)
    expect(window.location.hash).toBe('')
  })

  it('目标已挂载时按实测位置平滑滚动（标题 slug 路径）', async () => {
    const { host, scrollToCalls } = createScrollHost()
    installRectMock(host)
    installScrollIntoViewStub()

    const view = render(<MarkdownPreview content={'[就近跳转](#near-section)\n\n## Near Section'} />, { container: host })

    await act(async () => {
      fireEvent.click(view.getByRole('link', { name: '就近跳转' }))
    })

    // 标题 slug 在 DOM 中不存在（虚拟块标题 id 为 heading-{line}）→ 模型回退 →
    // data-md-line 目标已挂载 → 平滑滚动到实测位置
    expect(scrollToCalls).toHaveLength(1)
    expect(scrollToCalls[0]).toEqual(expect.objectContaining({ behavior: 'smooth' }))
    expect(scrollToCalls[0]?.top).toBeGreaterThanOrEqual(0)
    expect(window.location.hash).toBe('#near-section')
  })

  it('heading-{line} 内部锚点命中已挂载 DOM 时走 scrollIntoView', async () => {
    const { host, scrollToCalls } = createScrollHost()
    installRectMock(host)
    const scrollIntoView = installScrollIntoViewStub()

    const view = render(<MarkdownPreview content={'[内部锚点](#heading-3)\n\n## Near Section'} />, { container: host })

    await act(async () => {
      fireEvent.click(view.getByRole('link', { name: '内部锚点' }))
    })

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(scrollToCalls).toHaveLength(0)
    expect(window.location.hash).toBe('#heading-3')
  })
})
