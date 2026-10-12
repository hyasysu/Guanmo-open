import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, ContextMenuItem } from '@/components/common/ContextMenu'

afterEach(cleanup)

describe('ContextMenu', () => {
  it('renders outside a clipped stacking context and removes the portal on unmount', () => {
    const { unmount } = render(
      <div data-testid="sidebar-section" style={{ opacity: 0.9, overflow: 'hidden' }}>
        <ContextMenu position={{ x: 100, y: 120 }} onClose={vi.fn()}>
          <ContextMenuItem onClick={vi.fn()}>重命名</ContextMenuItem>
        </ContextMenu>
      </div>,
    )
    const menu = screen.getByText('重命名').closest('[data-context-menu]')
    expect(menu?.parentElement).toBe(document.body)
    expect(screen.getByTestId('sidebar-section').contains(menu)).toBe(false)
    unmount()
    expect(document.querySelector('[data-context-menu]')).toBeNull()
  })

  it('keeps item clicks isolated and closes on outside clicks and ancestor scrolling', () => {
    const onClose = vi.fn()
    const onAction = vi.fn()
    render(
      <div data-testid="scroll-container" onClick={vi.fn()}>
        <ContextMenu position={{ x: 100, y: 120 }} onClose={onClose}>
          <ContextMenuItem onClick={onAction}>打开文件位置</ContextMenuItem>
        </ContextMenu>
      </div>,
    )
    fireEvent.click(screen.getByText('打开文件位置'))
    expect(onAction).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.scroll(screen.getByTestId('scroll-container'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
