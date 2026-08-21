import { act, fireEvent, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'

/**
 * 虚拟块交互生命周期（阶段 3）
 *
 * 覆盖：
 * - 编辑中的块滚出 overscan 卸载再滚回重挂载：data-md-editing 恢复（原正文仍隐藏，
 *   不与编辑浮层形成双层内容）、编辑器与草稿保留；
 * - details 展开/折叠的用户瞬时状态跨虚拟块卸载重挂载保留；
 * - 文档内容变化 / 切换文档时交互状态整体失效，不串状态；
 * - 交互状态仅存预览实例局部 ref：不触发块提交、不写回文档内容。
 */

const VIEWPORT_HEIGHT = 800
const VIEWPORT_WIDTH = 600
const MEASURED_PARAGRAPH_HEIGHT = 60

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
  // 附加到 document.body：CodeMirror 需要 focus 才能接收键盘草稿输入
  host.dataset.testScrollHost = 'true'
  document.body.appendChild(host)
  let currentScrollTop = 0
  Object.defineProperties(host, {
    clientHeight: { configurable: true, get: () => VIEWPORT_HEIGHT },
    clientWidth: { configurable: true, get: () => VIEWPORT_WIDTH },
    scrollTop: {
      configurable: true,
      get: () => currentScrollTop,
      set: (value: number) => {
        currentScrollTop = value
      },
    },
    scrollTo: {
      configurable: true,
      writable: true,
      value: (options?: ScrollToOptions) => {
        if (options && typeof options.top === 'number') {
          host.scrollTop = options.top
          host.dispatchEvent(new Event('scroll'))
        }
      },
    },
  })
  return host
}

function installRectMock(host: HTMLElement) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const anchor = this.closest<HTMLElement>('[data-md-block-index]')
    if (!anchor) return makeRect(0, 0)
    const absTop = Number.parseFloat(anchor.style.top) || 0
    return makeRect(absTop - host.scrollTop, MEASURED_PARAGRAPH_HEIGHT)
  })
}

function altClick(element: Element) {
  fireEvent.pointerDown(element, { altKey: true, pointerId: 1, clientX: 10, clientY: 10 })
  fireEvent.pointerUp(element, { altKey: true, pointerId: 1, clientX: 10, clientY: 10 })
  fireEvent.click(element, { altKey: true, clientX: 10, clientY: 10 })
}

function makeLongContent(leadBlock: string) {
  return [
    leadBlock,
    ...Array.from({ length: 40 }, (_, index) => `\n\n匿名填充段落 ${index + 1}，用于把首块推出虚拟窗口。`),
  ].join('')
}

const FILLER_TAIL = '匿名填充段落 40，用于把首块推出虚拟窗口。'

function scrollTo(host: HTMLElement, top: number) {
  return act(async () => {
    host.scrollTo({ top })
  })
}

afterEach(() => {
  // RTL cleanup 只 unmount 组件，手动附加的滚动宿主需要自行移除
  document.querySelectorAll('[data-test-scroll-host]').forEach((element) => element.remove())
})

beforeAll(() => {
  // CodeMirror 测量依赖 Range 矩形 API（JSDOM 未实现）
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  }
})

describe('MarkdownPreview 虚拟块交互生命周期', () => {
  it('编辑中的块滚出 overscan 再滚回：编辑标记恢复、草稿保留、浮层不消失', async () => {
    const host = createScrollHost()
    installRectMock(host)
    const onBlockCommit = vi.fn(async () => ({ status: 'applied' as const }))
    const content = makeLongContent('编辑目标段落原文')

    render(
      <MarkdownPreview
        content={content}
        documentKey="doc-edit"
        documentVersion={1}
        inlineEditEnabled
        onBlockCommit={onBlockCommit}
      />,
      { container: host },
    )

    const firstBlock = host.querySelector<HTMLElement>('[data-md-block-index="0"]')
    expect(firstBlock).not.toBeNull()

    altClick(firstBlock as HTMLElement)
    const editor = await waitFor(() => {
      const el = host.querySelector<HTMLElement>('.cm-content')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(firstBlock).toHaveAttribute('data-md-editing')

    // 输入草稿
    const user = userEvent.setup()
    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}编辑草稿保留验证')

    // 滚出 overscan：目标块卸载，编辑浮层与草稿保留
    await scrollTo(host, 4000)
    expect(host.querySelector('[data-md-block-index="0"]')).toBeNull()
    expect(host.querySelector('.cm-editor')).not.toBeNull()
    expect(onBlockCommit).not.toHaveBeenCalled()

    // 滚回：块重挂载，编辑标记恢复（原正文仍隐藏，无双层内容），草稿仍在
    await scrollTo(host, 0)
    const remounted = host.querySelector<HTMLElement>('[data-md-block-index="0"]')
    expect(remounted).not.toBeNull()
    expect(remounted).toHaveAttribute('data-md-editing')
    expect(host.querySelector('.cm-editor')).not.toBeNull()
    expect(host.querySelector('.cm-content')).toHaveTextContent('编辑草稿保留验证')
    expect(onBlockCommit).not.toHaveBeenCalled()
  })

  it('details 展开后滚出再滚回保持用户展开状态', async () => {
    const host = createScrollHost()
    installRectMock(host)
    const content = makeLongContent('<details><summary>折叠标题</summary>折叠内容文本</details>')

    render(<MarkdownPreview content={content} documentKey="doc-details" />, { container: host })

    const details = await waitFor(() => {
      const el = host.querySelector('details')
      expect(el).not.toBeNull()
      return el as HTMLDetailsElement
    })
    expect(details.open).toBe(false)

    // 用户展开（JSDOM 不模拟 summary 默认行为，手动切换并派发 toggle）
    act(() => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(details.open).toBe(true)

    await scrollTo(host, 4000)
    expect(host.querySelector('[data-md-block-index="0"]')).toBeNull()

    await scrollTo(host, 0)
    const restored = host.querySelector('details')
    expect(restored).not.toBeNull()
    expect(restored?.open).toBe(true)
  })

  it('details 折叠后滚出再滚回保持用户折叠状态（初始 open）', async () => {
    const host = createScrollHost()
    installRectMock(host)
    const content = makeLongContent('<details open><summary>展开标题</summary>展开内容文本</details>')

    render(<MarkdownPreview content={content} documentKey="doc-details-open" />, { container: host })

    const details = await waitFor(() => {
      const el = host.querySelector('details')
      expect(el).not.toBeNull()
      return el as HTMLDetailsElement
    })
    expect(details.open).toBe(true)

    act(() => {
      details.open = false
      details.dispatchEvent(new Event('toggle'))
    })
    expect(details.open).toBe(false)

    await scrollTo(host, 4000)
    expect(host.querySelector('[data-md-block-index="0"]')).toBeNull()

    await scrollTo(host, 0)
    const restored = host.querySelector('details')
    expect(restored).not.toBeNull()
    expect(restored?.open).toBe(false)
  })

  it('文档内容变化后 details 状态整体失效，恢复 Markdown 初始状态', async () => {
    const host = createScrollHost()
    installRectMock(host)
    const content = makeLongContent('<details><summary>失效标题</summary>失效内容文本</details>')

    const view = render(<MarkdownPreview content={content} documentKey="doc-invalidate" />, { container: host })

    const details = await waitFor(() => {
      const el = host.querySelector('details')
      expect(el).not.toBeNull()
      return el as HTMLDetailsElement
    })
    act(() => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(details.open).toBe(true)

    // 远处段落内容变化（details 块自身内容不变）
    const changedContent = content.replace(FILLER_TAIL, '匿名填充段落 40 的已变化内容。')
    view.rerender(<MarkdownPreview content={changedContent} documentKey="doc-invalidate" />)

    await scrollTo(host, 4000)
    expect(host.querySelector('[data-md-block-index="0"]')).toBeNull()

    await scrollTo(host, 0)
    const restored = host.querySelector('details')
    expect(restored).not.toBeNull()
    // 内容变化 → 交互状态已失效 → 恢复源码初始折叠状态
    expect(restored?.open).toBe(false)
  })

  it('切换文档后 details 状态不串（documentKey 变化即失效）', async () => {
    const host = createScrollHost()
    installRectMock(host)
    const content = makeLongContent('<details><summary>切换标题</summary>切换内容文本</details>')

    const view = render(
      <MarkdownPreview content={content} documentKey="doc-a" />,
      { container: host },
    )

    const details = await waitFor(() => {
      const el = host.querySelector('details')
      expect(el).not.toBeNull()
      return el as HTMLDetailsElement
    })
    act(() => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(details.open).toBe(true)

    view.rerender(<MarkdownPreview content={content} documentKey="doc-b" />)

    await scrollTo(host, 4000)
    expect(host.querySelector('[data-md-block-index="0"]')).toBeNull()

    await scrollTo(host, 0)
    const restored = host.querySelector('details')
    expect(restored).not.toBeNull()
    // 切文档 → 旧文档交互状态失效 → 新文档恢复初始折叠
    expect(restored?.open).toBe(false)
  })

  it('details 交互不触发块提交（瞬时状态不进入提交链路）', async () => {
    const host = createScrollHost()
    installRectMock(host)
    const onBlockCommit = vi.fn(async () => ({ status: 'applied' as const }))
    const content = makeLongContent('<details><summary>提交标题</summary>提交内容文本</details>')

    render(
      <MarkdownPreview
        content={content}
        documentKey="doc-no-commit"
        documentVersion={1}
        inlineEditEnabled
        onBlockCommit={onBlockCommit}
      />,
      { container: host },
    )

    const details = await waitFor(() => {
      const el = host.querySelector('details')
      expect(el).not.toBeNull()
      return el as HTMLDetailsElement
    })
    act(() => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })

    await scrollTo(host, 4000)
    await scrollTo(host, 0)

    expect(host.querySelector('details')?.open).toBe(true)
    expect(onBlockCommit).not.toHaveBeenCalled()
  })
})
