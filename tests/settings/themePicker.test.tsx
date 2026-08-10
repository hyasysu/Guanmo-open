import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemePicker } from '@/features/settings/ThemePicker'

describe('主题选择卡片', () => {
  it('展示全部官方主题并立即提交选择', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ThemePicker value="warm" onChange={onChange} />)

    expect(screen.getAllByRole('radio')).toHaveLength(5)
    expect(screen.getByRole('radio', { name: /暖色/ })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('radio', { name: /GitHub Light/ }))
    expect(onChange).toHaveBeenCalledWith('github-light')
  })
})
