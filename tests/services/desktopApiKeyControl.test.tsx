import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const native = vi.hoisted(() => ({ sync: vi.fn() }))
vi.mock('@/stores/settingsStore', () => ({ syncDesktopCredential: native.sync }))
import { DesktopApiKeyControl } from '@/features/settings/DesktopApiKeyControl'
beforeEach(() => { cleanup(); native.sync.mockReset(); native.sync.mockResolvedValue(undefined) })
describe('desktop key editing', () => {
  it('never displays an existing key, leaves blank unchanged, clears a successfully saved input and deletes explicitly', async () => {
    render(<DesktopApiKeyControl kind="chat" configured label="对话 API Key" />)
    const input = screen.getByLabelText('对话 API Key')
    expect(input).toHaveValue('')
    expect(screen.getByText('替换 Key').closest('button')).toBeDisabled()
    expect(native.sync).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'synthetic-new-key' } })
    fireEvent.click(screen.getByText('替换 Key'))
    await waitFor(() => expect(input).toHaveValue(''))
    expect(native.sync).toHaveBeenCalledWith('chat', { value: 'synthetic-new-key' })
    fireEvent.click(screen.getByText('删除 Key'))
    await waitFor(() => expect(native.sync).toHaveBeenCalledWith('chat', { remove: true }))
  })
  it('retains only the unsaved local draft on failure and shows a fixed error for retry', async () => {
    native.sync.mockRejectedValueOnce(new Error('synthetic-sensitive-detail'))
    render(<DesktopApiKeyControl kind="embedding" label="Embedding API Key" />)
    fireEvent.change(screen.getByLabelText('Embedding API Key'), { target: { value: 'synthetic-draft' } })
    fireEvent.click(screen.getByText('保存 Key'))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).not.toHaveTextContent('synthetic-sensitive-detail')
    expect(screen.getByLabelText('Embedding API Key')).toHaveValue('synthetic-draft')
    fireEvent.click(screen.getByText('保存 Key'))
    await waitFor(() => expect(screen.getByLabelText('Embedding API Key')).toHaveValue(''))
  })
  it('clears unsaved input when the target identity changes', () => {
    const view = render(<DesktopApiKeyControl key="target-a" kind="search" configured label="联网搜索 API Key" />)
    fireEvent.change(screen.getByLabelText('联网搜索 API Key'), { target: { value: 'synthetic-target-a' } })
    view.rerender(<DesktopApiKeyControl key="target-b" kind="search" label="联网搜索 API Key" />)
    expect(screen.getByLabelText('联网搜索 API Key')).toHaveValue('')
    expect(native.sync).not.toHaveBeenCalled()
  })
})
