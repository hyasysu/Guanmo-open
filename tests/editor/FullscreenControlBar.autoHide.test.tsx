import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FullscreenControlBar } from '@/components/editor/FullscreenControlBar'

vi.mock('@/hooks/useFullscreen', () => ({
  useFullscreen: () => ({ exitFullscreen: vi.fn() }),
}))

describe('FullscreenControlBar auto hide', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hides after the pointer leaves the top reveal region without entering the bar', () => {
    const { container } = render(
      <FullscreenControlBar
        fileDrawerOpen={false}
        onToggleFileDrawer={vi.fn()}
        onCloseFileDrawer={vi.fn()}
      />,
    )
    const trigger = container.querySelector<HTMLElement>('[data-fullscreen-control-trigger]')
    const bar = container.querySelector<HTMLElement>('[data-fullscreen-control-bar]')

    expect(trigger).not.toBeNull()
    expect(bar).toHaveClass('opacity-0')

    fireEvent.mouseEnter(trigger!)
    expect(bar).toHaveClass('opacity-100')

    fireEvent.mouseLeave(trigger!)
    act(() => vi.advanceTimersByTime(699))
    expect(bar).toHaveClass('opacity-100')

    act(() => vi.advanceTimersByTime(1))
    expect(bar).toHaveClass('opacity-0')
  })

  it('restarts auto hide after the file drawer closes while the pointer is outside', () => {
    const props = {
      onToggleFileDrawer: vi.fn(),
      onCloseFileDrawer: vi.fn(),
    }
    const { container, rerender } = render(
      <FullscreenControlBar fileDrawerOpen {...props} />,
    )
    const bar = container.querySelector<HTMLElement>('[data-fullscreen-control-bar]')

    expect(bar).toHaveClass('opacity-100')
    fireEvent.mouseLeave(bar!)

    rerender(<FullscreenControlBar fileDrawerOpen={false} {...props} />)
    act(() => vi.advanceTimersByTime(700))

    expect(bar).toHaveClass('opacity-0')
  })
})
