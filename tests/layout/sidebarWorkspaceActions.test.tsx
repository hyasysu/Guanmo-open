import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAppStore } from '@/stores/appStore'
import { useEditorStore } from '@/stores/editorStore'

const workspaceTree = vi.hoisted(() => ({
  workspacePath: 'C:\\workspace',
  workspaceFiles: [],
  workspaceHiddenCount: 0,
  loadWorkspace: vi.fn(),
  refreshWorkspace: vi.fn(),
  closeWorkspace: vi.fn(),
}))

vi.mock('@/hooks/useWorkspaceFileTree', () => ({
  useWorkspaceFileTree: () => workspaceTree,
}))

describe('Sidebar workspace actions', () => {
  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
    useAppStore.setState({ aiPanelOpen: false, aiPanelWidth: 360 })
    useEditorStore.setState({ tabs: [], recentFiles: [], favorites: [] })
  })

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    vi.clearAllMocks()
  })

  it('shows Workspace creation and folder-tree actions as icon buttons', () => {
    render(
      <Sidebar
        collapsed={false}
        width={260}
        onOpenSettings={vi.fn()}
        onOpenSearch={vi.fn()}
      />
    )

    const newFile = screen.getByRole('button', { name: '新建文件' })
    const newFolder = screen.getByRole('button', { name: '新建文件夹' })
    expect(screen.getByRole('button', { name: '展开工作区中的所有文件夹' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '折叠工作区中的所有文件夹' })).toBeInTheDocument()

    fireEvent.click(newFile)
    expect(screen.getByDisplayValue('untitled.md')).toBeInTheDocument()

    fireEvent.click(newFolder)
    expect(screen.getByDisplayValue('新建文件夹')).toBeInTheDocument()
  })
})
