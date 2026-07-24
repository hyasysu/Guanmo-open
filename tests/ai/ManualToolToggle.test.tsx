import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManualToolToggle } from '@/components/ai/ManualToolToggle'
import { useSettingsStore } from '@/stores/settingsStore'

vi.mock('@/services/database/db', () => ({
  isDatabaseReady: () => true,
}))

vi.mock('@/services/rag/pipeline', () => ({
  getRagStatsAsync: async () => ({ documents: 1 }),
}))

describe('ManualToolToggle 联网搜索状态', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useSettingsStore.setState((state) => ({
      ai: { ...state.ai, webSearchEnabled: false },
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('提示开启设置，并在设置变化后立即恢复可用', async () => {
    render(<ManualToolToggle onChange={vi.fn()} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    const webSearchButton = screen.getByRole('button', { name: '联网搜索' })
    expect(webSearchButton).toBeDisabled()

    fireEvent.mouseEnter(webSearchButton.parentElement as HTMLElement)
    act(() => vi.advanceTimersByTime(320))
    expect(screen.getByRole('tooltip')).toHaveTextContent('请在设置中开启联网搜索')
    fireEvent.mouseLeave(webSearchButton.parentElement as HTMLElement)

    act(() => {
      useSettingsStore.setState((state) => ({
        ai: { ...state.ai, webSearchEnabled: true },
      }))
    })

    expect(screen.getByRole('button', { name: '联网搜索' })).toBeEnabled()
  })

  it.each([
    { name: '查知识库', left: 0 },
    { name: '联网搜索', left: 160 },
  ])('窄窗口中 $name 的提示保持在应用窗口内', ({ name, left: triggerLeft }) => {
    vi.stubGlobal('innerWidth', 240)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
      return this.getAttribute('role') === 'tooltip' ? 220 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
      return this.getAttribute('role') === 'tooltip' ? 30 : 0
    })

    render(<ManualToolToggle onChange={vi.fn()} />)

    const button = screen.getByRole('button', { name })
    const trigger = button.parentElement as HTMLElement
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: triggerLeft,
      y: 160,
      left: triggerLeft,
      top: 160,
      right: triggerLeft + 80,
      bottom: 188,
      width: 80,
      height: 28,
      toJSON: () => ({}),
    })

    fireEvent.mouseEnter(trigger)
    act(() => vi.advanceTimersByTime(320))

    const tooltip = screen.getByRole('tooltip')
    const left = Number.parseFloat(tooltip.style.left)
    expect(left).toBeGreaterThanOrEqual(8)
    expect(left + tooltip.offsetWidth).toBeLessThanOrEqual(window.innerWidth - 8)
    expect(tooltip).toHaveClass('gm-tooltip--top')
  })
})
