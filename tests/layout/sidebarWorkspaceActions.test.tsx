import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workspaceTree = vi.hoisted(() => ({
  workspaceRoots: [{ id: 'root-a', path: 'C:\\workspace', name: 'workspace' }],
  workspaceTrees: {
    'root-a': {
      nodes: [],
      hiddenCount: 0,
      loading: false,
      error: null,
    },
  },
  addWorkspaceRoot: vi.fn(),
  removeWorkspace: vi.fn(),
  refreshWorkspaceRoot: vi.fn(),
}))

vi.mock('@/hooks/useWorkspaceFileTree', () => ({
  useWorkspaceFileTree: () => workspaceTree,
}))

describe('Sidebar workspace actions', () => {
  beforeEach(() => {
    workspaceTree.addWorkspaceRoot.mockReturnValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows workspace creation and folder-tree actions for each root', async () => {
    const { WorkspaceRoots } = await import('@/components/file-tree/WorkspaceRoots')
    render(<WorkspaceRoots onOpenFile={vi.fn()} />)

    const newFile = screen.getByRole('button', { name: '新建文件 workspace' })
    const newFolder = screen.getByRole('button', { name: '新建文件夹 workspace' })
    expect(screen.getByRole('button', { name: '展开所有文件夹 workspace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '折叠所有文件夹 workspace' })).toBeInTheDocument()

    fireEvent.click(newFile)
    expect(screen.getByDisplayValue('untitled.md')).toBeInTheDocument()

    fireEvent.click(newFolder)
    expect(screen.getByDisplayValue('新建文件夹')).toBeInTheDocument()
  })
})
