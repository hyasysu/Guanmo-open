import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const globalStyles = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')

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
    const rootToggle = screen.getByRole('button', { name: '折叠 workspace' })
    const rootHeader = rootToggle.closest('.gm-workspace-root-header')
    const rootActions = rootHeader?.querySelector('.gm-workspace-root-actions')
    expect(rootHeader).not.toBeNull()
    expect(rootHeader?.firstElementChild).toBe(rootActions)
    expect(rootHeader?.lastElementChild).toBe(rootToggle)
    expect(rootToggle.querySelector('.gm-workspace-root-name')).toHaveTextContent('workspace')
    expect(rootActions).toContainElement(newFile)
    expect(rootActions).toContainElement(newFolder)
    expect(newFile.querySelector('svg')).toBeInTheDocument()
    expect(newFolder.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '索引 workspace' }).querySelector('svg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开所有文件夹 workspace' }).querySelector('svg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '折叠所有文件夹 workspace' }).querySelector('svg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新 workspace' }).querySelector('svg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移除工作区 workspace' }).querySelector('svg')).toBeInTheDocument()
    expect(globalStyles).toMatch(/@container workspace-roots \(max-width: 320px\)[\s\S]*?\.gm-workspace-root-name \{[\s\S]*?white-space: normal;/)
    expect(globalStyles).toMatch(/\.gm-workspace-root-header \{[\s\S]*?flex-direction: column;[\s\S]*?align-items: flex-start;/)
    expect(globalStyles).toMatch(/\.gm-workspace-root-actions \{[\s\S]*?justify-content: flex-start;[\s\S]*?width: max-content;/)

    fireEvent.click(newFile)
    expect(screen.getByDisplayValue('untitled.md')).toBeInTheDocument()

    fireEvent.click(newFolder)
    expect(screen.getByDisplayValue('新建文件夹')).toBeInTheDocument()
  })
})
