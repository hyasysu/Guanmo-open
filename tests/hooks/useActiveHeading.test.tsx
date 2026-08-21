import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useActiveHeading, type ActiveHeadingGeometry } from '@/hooks/useActiveHeading'

const flushFrames = async (frames = 1) => {
  for (let i = 0; i < frames; i += 1) {
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  }
}

function defineGeometry(element: HTMLElement, viewportHeight: number) {
  Object.defineProperties(element, {
    scrollTop: { configurable: true, writable: true, value: 0 },
    clientHeight: { configurable: true, get: () => viewportHeight },
  })
}

function Harness({
  resolver,
  trigger,
  enabled = true,
  showContainer = true,
}: {
  resolver: ((geometry: ActiveHeadingGeometry) => string | null) | null
  trigger?: unknown
  enabled?: boolean
  showContainer?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeHeading = useActiveHeading(containerRef, resolver, trigger, enabled)

  return (
    <>
      {showContainer && <div ref={containerRef} data-testid="preview-container" />}
      <output>{activeHeading ?? 'none'}</output>
    </>
  )
}

describe('useActiveHeading（滚动几何 + 模型驱动 resolver）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('挂载后立即用容器几何计算活跃标题，不依赖任何标题 DOM', () => {
    const resolver = vi.fn(() => 'section-model-driven')
    render(<Harness resolver={resolver} />)

    expect(screen.getByText('section-model-driven', { selector: 'output' })).toBeInTheDocument()
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({
      scrollTop: 0,
      viewportHeight: 0,
    }))
  })

  it('滚动事件触发 rAF 节流重算，并把最新滚动几何交给 resolver', async () => {
    const resolver = vi.fn(({ scrollTop }: ActiveHeadingGeometry) => (
      scrollTop >= 1000 ? 'deep-section' : 'top-section'
    ))
    render(<Harness resolver={resolver} />)
    const container = screen.getByTestId('preview-container')
    defineGeometry(container, 800)

    container.scrollTop = 1200
    fireEvent.scroll(container)
    await flushFrames()

    expect(resolver).toHaveBeenLastCalledWith({ scrollTop: 1200, viewportHeight: 800 })
    expect(screen.getByText('deep-section', { selector: 'output' })).toBeInTheDocument()

    // 未再滚动时不重复计算（rAF 节流，无空闲轮询）
    const callsAfterScroll = resolver.mock.calls.length
    await flushFrames(2)
    expect(resolver.mock.calls.length).toBe(callsAfterScroll)
  })

  it('长章节区间：resolver 持续返回上一标题时目录项不变空', async () => {
    const resolver = vi.fn(() => 'last-passed-heading')
    render(<Harness resolver={resolver} />)
    const container = screen.getByTestId('preview-container')
    defineGeometry(container, 800)

    for (const scrollTop of [300, 900, 2500, 5000]) {
      container.scrollTop = scrollTop
      fireEvent.scroll(container)
      await flushFrames()
      expect(screen.getByText('last-passed-heading', { selector: 'output' })).toBeInTheDocument()
    }
  })

  it('trigger 变化（切文档/版本）后重置并按新 resolver 重算', async () => {
    const resolverA = vi.fn(() => 'doc-a-heading')
    const resolverB = vi.fn(() => 'doc-b-heading')
    const { rerender } = render(<Harness resolver={resolverA} trigger="doc-a" />)
    expect(screen.getByText('doc-a-heading', { selector: 'output' })).toBeInTheDocument()

    rerender(<Harness resolver={resolverB} trigger="doc-b" />)
    await flushFrames()

    expect(resolverB).toHaveBeenCalled()
    expect(screen.getByText('doc-b-heading', { selector: 'output' })).toBeInTheDocument()
  })

  it('enabled=false 时不计算、不返回活跃标题', () => {
    const resolver = vi.fn(() => 'should-not-run')
    render(<Harness resolver={resolver} enabled={false} />)

    expect(resolver).not.toHaveBeenCalled()
    expect(screen.getByText('none', { selector: 'output' })).toBeInTheDocument()
  })

  it('容器晚于 hook 挂载时通过 rAF 重试，最终完成初始计算', async () => {
    const resolver = vi.fn(({ scrollTop }: ActiveHeadingGeometry) => (
      scrollTop >= 100 ? 'late-container-heading' : 'late-top'
    ))
    const { rerender } = render(<Harness resolver={resolver} showContainer={false} />)
    expect(resolver).not.toHaveBeenCalled()

    rerender(<Harness resolver={resolver} showContainer />)
    const container = screen.getByTestId('preview-container')
    defineGeometry(container, 600)
    container.scrollTop = 150
    await flushFrames(3)

    expect(resolver).toHaveBeenCalled()
    expect(screen.getByText('late-container-heading', { selector: 'output' })).toBeInTheDocument()
  })

  it('卸载后移除滚动监听，不再调用 resolver', async () => {
    const resolver = vi.fn(() => 'heading')
    const { unmount } = render(<Harness resolver={resolver} />)
    const container = screen.getByTestId('preview-container')
    defineGeometry(container, 800)
    const callsAtUnmount = resolver.mock.calls.length

    unmount()
    container.scrollTop = 4321
    fireEvent.scroll(container)
    await flushFrames(2)

    expect(resolver.mock.calls.length).toBe(callsAtUnmount)
  })
})
