import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SmoothStreamingText, StreamingBubbleContent } from '@/components/ai/SmoothStreamingText'
import { ChatBubble } from '@/components/ai/AiPanel'

describe('SmoothStreamingText', () => {
  afterEach(() => vi.restoreAllMocks())

  it('逐帧显示突发文本，并在三帧内追平', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)

    const view = render(<SmoothStreamingText content="开" />)
    view.rerender(<SmoothStreamingText content="开始输出一大段连续文字" />)
    expect(view.container.textContent).toBe('开')

    act(() => { frames.shift()?.(0) })
    expect(view.container.textContent?.length).toBeGreaterThan(1)
    expect(view.container.textContent?.length).toBeLessThan('开始输出一大段连续文字'.length)

    act(() => { frames.shift()?.(16) })
    act(() => { frames.shift()?.(32) })
    expect(view.container.textContent).toBe('开始输出一大段连续文字')

    view.rerender(<SmoothStreamingText content="开始输出一大段连续文字，继续" />)
    view.unmount()
    expect(window.cancelAnimationFrame).toHaveBeenCalled()
  })

  it('前缀被替换时立即显示新内容', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
    const view = render(<SmoothStreamingText content="旧内容" />)
    view.rerender(<SmoothStreamingText content="新回答" />)
    expect(view.container.textContent).toBe('新回答')
  })

  it('新增词独立显现，保留旧词节点及换行、emoji', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
    const view = render(<SmoothStreamingText content="Hello" />)
    const firstWord = view.container.querySelector('.gm-streaming-word')
    const content = 'Hello world\n第二段🙂'
    view.rerender(<SmoothStreamingText content={content} />)
    for (let i = 0; i < 3; i++) act(() => { frames.shift()?.(i * 16) })

    expect(view.container.textContent).toBe(content)
    expect(view.container.querySelector('.gm-streaming-word')).toBe(firstWord)
    expect(view.container.querySelectorAll('.gm-streaming-word').length).toBeGreaterThan(1)
  })

  it('减少动态效果时直接显示全文，不排队播放文字动画', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const view = render(<SmoothStreamingText content="开" />)
    view.rerender(<SmoothStreamingText content="开始完整回答" />)
    expect(view.container.textContent).toBe('开始完整回答')
    expect(view.container.querySelector('.gm-streaming-word')).toBeNull()
    expect(raf).not.toHaveBeenCalled()
  })

  it('切入后台立即追平并取消待展示帧', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 42)
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const view = render(<SmoothStreamingText content="开" />)
    view.rerender(<SmoothStreamingText content="开始完整回答" />)
    hidden.mockReturnValue(true)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(view.container.textContent).toBe('开始完整回答')
    expect(cancel).toHaveBeenCalledWith(42)
  })

  it('流结束时立即显示完整最终回答', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    const view = render(<ChatBubble role="assistant" content="开" isLast streaming />)
    expect(view.container.querySelectorAll('.gm-streaming-caret')).toHaveLength(1)
    view.rerender(<ChatBubble role="assistant" content="开始输出完整回答" isLast streaming />)
    expect(view.container.textContent).not.toContain('开始输出完整回答')
    view.rerender(<ChatBubble role="assistant" content="开始输出完整回答" isLast streaming={false} />)
    expect(view.container.textContent).toContain('开始输出完整回答')
    expect(view.container.querySelector('.gm-streaming-caret')).toBeNull()
  })

  it('只在输出期间测量自然高度，结束及卸载时释放观察器', () => {
    const observe = vi.spyOn(ResizeObserver.prototype, 'observe')
    const disconnect = vi.spyOn(ResizeObserver.prototype, 'disconnect')
    const view = render(<StreamingBubbleContent active={false}>历史回答</StreamingBubbleContent>)
    expect(observe).not.toHaveBeenCalled()
    view.rerender(<StreamingBubbleContent active>新增回答</StreamingBubbleContent>)
    expect(observe).toHaveBeenCalledTimes(1)
    expect(observe.mock.calls[0][0].textContent).toBe('新增回答')
    view.rerender(<StreamingBubbleContent active={false}>完整回答</StreamingBubbleContent>)
    expect(disconnect).toHaveBeenCalledTimes(1)
    view.rerender(<StreamingBubbleContent active>第二次输出</StreamingBubbleContent>)
    view.unmount()
    expect(disconnect).toHaveBeenCalledTimes(2)
  })
})
