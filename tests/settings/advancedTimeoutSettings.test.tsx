import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdvancedTimeoutSettings } from '@/features/settings/AdvancedTimeoutSettings'

describe('高级超时设置', () => {
  it('默认收起，展开后可修改超时', () => {
    const onChange = vi.fn()
    render(<AdvancedTimeoutSettings value={60000} onChange={onChange} />)

    const toggle = screen.getByRole('button', { name: '高级设置' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('slider', { name: '请求超时' })).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.change(screen.getByRole('slider', { name: '请求超时' }), { target: { value: '90' } })
    expect(onChange).toHaveBeenLastCalledWith(90000)
  })
})
