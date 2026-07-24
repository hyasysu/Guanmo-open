import { act, render, screen } from '@testing-library/react'
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
    vi.useRealTimers()
  })

  it('提示开启设置，并在设置变化后立即恢复可用', async () => {
    render(<ManualToolToggle onChange={vi.fn()} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(screen.getByRole('button', { name: '联网搜索' })).toBeDisabled()
    expect(screen.getByText('请在设置中开启联网搜索')).toBeInTheDocument()

    act(() => {
      useSettingsStore.setState((state) => ({
        ai: { ...state.ai, webSearchEnabled: true },
      }))
    })

    expect(screen.getByRole('button', { name: '联网搜索' })).toBeEnabled()
  })

  it('右侧两个工具的提示向左展开，避免超出应用窗口', () => {
    render(<ManualToolToggle onChange={vi.fn()} />)

    expect(screen.getByText('选中后强制查询长期记忆，回答基于您的历史偏好和习惯'))
      .toHaveClass('gm-manual-tool-tooltip--right')
    expect(screen.getByText('请在设置中开启联网搜索'))
      .toHaveClass('gm-manual-tool-tooltip--right')
  })
})
