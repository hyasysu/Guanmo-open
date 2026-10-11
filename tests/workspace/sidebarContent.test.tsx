import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSidebarContent } from '@/components/layout/useSidebarContent'

function Panel({ open, keepMounted = false, active = true }: { open: boolean; keepMounted?: boolean; active?: boolean }) {
  const { contentRef, present } = useSidebarContent(open, '#sidebar-trigger', { keepMounted, active })
  return <>
    <button id="sidebar-trigger">切换</button>
    {present && <div ref={contentRef} aria-hidden={!open} data-testid="content"><input aria-label="侧栏输入" /></div>}
  </>
}

describe('sidebar exit content', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
  })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

  it('does not mount a sidebar that starts closed', () => {
    render(<Panel open={false} />)
    expect(screen.queryByTestId('content')).toBeNull()
  })

  it('keeps visited content and its scroll position inert after closing', () => {
    const view = render(<Panel open={false} keepMounted />)
    expect(screen.queryByTestId('content')).toBeNull()
    view.rerender(<Panel open keepMounted />)
    const content = screen.getByTestId('content')
    content.scrollTop = 360
    screen.getByLabelText('侧栏输入').focus()
    view.rerender(<Panel open={false} keepMounted />)
    act(() => vi.advanceTimersByTime(300))
    expect(screen.getByTestId('content')).toBe(content)
    expect(content.inert).toBe(true)
    expect(screen.getByText('切换')).toHaveFocus()
    view.rerender(<Panel open keepMounted />)
    expect(screen.getByTestId('content')).toBe(content)
    expect(content.scrollTop).toBe(360)
    expect(content.inert).toBe(false)
  })

  it('does not mount retained content in a different layout before opening it', () => {
    const view = render(<Panel open keepMounted />)
    view.rerender(<Panel open={false} keepMounted active={false} />)
    expect(screen.queryByTestId('content')).toBeNull()
    view.rerender(<Panel open={false} keepMounted />)
    expect(screen.queryByTestId('content')).toBeNull()
  })

  it('retains exit content while blocking focus and moves focus to the trigger', () => {
    const view = render(<Panel open />)
    screen.getByLabelText('侧栏输入').focus()
    view.rerender(<Panel open={false} />)
    expect(screen.getByTestId('content').inert).toBe(true)
    expect(screen.getByTestId('content')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('切换')).toHaveFocus()
    act(() => vi.advanceTimersByTime(220))
    expect(screen.queryByTestId('content')).toBeNull()
  })

  it('cancels pending removal when quickly reopened', () => {
    const view = render(<Panel open />)
    const input = screen.getByLabelText('侧栏输入')
    view.rerender(<Panel open={false} />)
    act(() => vi.advanceTimersByTime(100))
    view.rerender(<Panel open />)
    act(() => vi.advanceTimersByTime(300))
    expect(screen.getByLabelText('侧栏输入')).toBe(input)
    expect(screen.getByTestId('content').inert).toBe(false)
  })

  it('removes exit content without an animation delay under reduced motion', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    const view = render(<Panel open />)
    view.rerender(<Panel open={false} />)
    act(() => vi.advanceTimersByTime(0))
    expect(screen.queryByTestId('content')).toBeNull()
  })
})
