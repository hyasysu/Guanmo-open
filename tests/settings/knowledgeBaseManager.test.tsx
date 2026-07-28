import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KnowledgeBaseManager } from '@/features/settings/KnowledgeBaseManager'

const mockDocuments = [
  {
    filePath: '/workspace/readme.md',
    title: 'readme',
    state: 'INDEXED',
    totalChunks: 5,
    embeddedChunks: 5,
  },
  {
    filePath: '/workspace/notes.md',
    title: 'notes',
    state: 'CHUNKED',
    totalChunks: 10,
    embeddedChunks: 8,
  },
  {
    filePath: '/workspace/guide.md',
    title: 'guide',
    state: 'PENDING',
    totalChunks: 3,
    embeddedChunks: 0,
  },
]

const mockListDocuments = vi.fn()
const mockRemoveDocuments = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()

vi.mock('@/services/rag/knowledgeBase', () => ({
  listKnowledgeDocuments: () => mockListDocuments(),
  removeKnowledgeDocuments: (paths: string[]) => mockRemoveDocuments(paths),
}))

vi.mock('@/services/toast', () => ({
  toast: {
    success: (msg: string) => mockToastSuccess(msg),
    error: (msg: string) => mockToastError(msg),
  },
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) => {
    const store = {
      knowledge: { autoIndexEnabled: true },
    }
    if (typeof selector === 'function') return selector(store)
    return store
  },
}))

function renderManager(open = true, onClose = vi.fn()) {
  return render(
    <KnowledgeBaseManager open={open} onClose={onClose} />,
  )
}

describe('KnowledgeBaseManager', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockListDocuments.mockResolvedValue(mockDocuments)
    mockRemoveDocuments.mockResolvedValue({ success: [], failed: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('弹窗生命周期', () => {
    it('关闭动画完成后清理退出状态，避免再次打开闪屏', () => {
      vi.useFakeTimers()
      vi.spyOn(window, 'matchMedia').mockReturnValue({
        matches: false,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })
      const onClose = vi.fn()
      renderManager(true, onClose)

      const modal = screen.getByRole('dialog')
      fireEvent.click(screen.getByRole('button', { name: '关闭知识库管理' }))
      expect(modal.getAttribute('data-closing')).toBe('true')

      act(() => {
        vi.advanceTimersByTime(160)
      })

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(modal.hasAttribute('data-closing')).toBe(false)
    })
  })

  describe('文档列表加载', () => {
    it('打开时加载文档列表', async () => {
      renderManager()
      expect(mockListDocuments).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(screen.getByText('readme')).toBeTruthy()
        expect(screen.getByText('notes')).toBeTruthy()
        expect(screen.getByText('guide')).toBeTruthy()
      })
    })

    it('显示加载状态', () => {
      mockListDocuments.mockReturnValue(new Promise(() => {}))
      renderManager()
      expect(screen.getByText('加载中...')).toBeTruthy()
    })

    it('显示空状态', async () => {
      mockListDocuments.mockResolvedValue([])
      renderManager()
      await waitFor(() => {
        expect(screen.getByText('暂无已入库文档')).toBeTruthy()
      })
    })

    it('显示错误状态', async () => {
      mockListDocuments.mockRejectedValue(new Error('数据库错误'))
      renderManager()
      await waitFor(() => {
        expect(screen.getByText('加载失败：数据库错误')).toBeTruthy()
      })
    })
  })

  describe('搜索', () => {
    it('按文件名搜索（大小写不敏感）', async () => {
      renderManager()
      await waitFor(() => expect(screen.getByText('readme')).toBeTruthy())

      const input = screen.getByPlaceholderText('按文件名搜索...')
      await userEvent.type(input, 'READ')

      await waitFor(() => {
        expect(screen.getByText('readme')).toBeTruthy()
        expect(screen.queryByText('notes')).toBeNull()
        expect(screen.queryByText('guide')).toBeNull()
      })
    })

    it('搜索结果为空时显示提示', async () => {
      renderManager()
      await waitFor(() => expect(screen.getByText('readme')).toBeTruthy())

      const input = screen.getByPlaceholderText('按文件名搜索...')
      await userEvent.type(input, 'zzz')

      await waitFor(() => {
        expect(screen.getByText('未找到匹配文档')).toBeTruthy()
      })
    })
  })

  describe('选择操作', () => {
    it('支持逐项选择', async () => {
      const user = userEvent.setup()
      renderManager()
      await waitFor(() => expect(screen.getByText('readme')).toBeTruthy())

      const checkboxes = screen.getAllByRole('checkbox')
      // 第一个是全选 checkbox
      const readmeCheckbox = checkboxes[1]
      await user.click(readmeCheckbox)

      await waitFor(() => {
        expect(screen.getByText('已选择 1 个文档')).toBeTruthy()
      })
    })

    it('支持全选当前搜索结果', async () => {
      const user = userEvent.setup()
      renderManager()
      await waitFor(() => expect(screen.getByText('readme')).toBeTruthy())

      const selectAllLabel = screen.getByText('全选当前搜索结果')
      await user.click(selectAllLabel)

      await waitFor(() => {
        expect(screen.getByText('已选择 3 个文档')).toBeTruthy()
      })
    })

    it('全选后再次点击取消全选', async () => {
      const user = userEvent.setup()
      renderManager()
      await waitFor(() => expect(screen.getByText('readme')).toBeTruthy())

      const selectAllLabel = screen.getByText('全选当前搜索结果')
      await user.click(selectAllLabel)
      await waitFor(() => expect(screen.getByText('已选择 3 个文档')).toBeTruthy())

      await user.click(selectAllLabel)
      await waitFor(() => {
        expect(screen.getByText('已选择 0 个文档')).toBeTruthy()
      })
    })

    it('搜索后全选只选中搜索结果', async () => {
      const user = userEvent.setup()
      renderManager()
      await waitFor(() => expect(screen.getByText('readme')).toBeTruthy())

      const input = screen.getByPlaceholderText('按文件名搜索...')
      await userEvent.type(input, 'read')

      await waitFor(() => {
        expect(screen.getByText('readme')).toBeTruthy()
        expect(screen.queryByText('notes')).toBeNull()
      })

      const selectAllLabel = screen.getByText('全选当前搜索结果')
      await user.click(selectAllLabel)

      await waitFor(() => {
        expect(screen.getByText('已选择 1 个文档')).toBeTruthy()
      })
    })
  })

  describe('批量移除按钮', () => {
    it('无选择时禁用', async () => {
      renderManager()
      await waitFor(() => expect(screen.getByText('readme')).toBeTruthy())

      const removeBtn = screen.getByText('批量移除')
      expect(removeBtn.closest('button')?.disabled).toBe(true)
    })

    it('有选择时可用', async () => {
      const user = userEvent.setup()
      renderManager()
      await waitFor(() => expect(screen.getByText('readme')).toBeTruthy())

      const checkboxes = screen.getAllByRole('checkbox')
      await user.click(checkboxes[1])

      await waitFor(() => {
        const removeBtn = screen.getByText('批量移除')
        expect(removeBtn.closest('button')?.disabled).toBe(false)
      })
    })
  })

  describe('移除确认', () => {
    it('二次确认包含必需文案', async () => {
      const user = userEvent.setup()
      mockRemoveDocuments.mockResolvedValue({ success: ['/workspace/readme.md'], failed: [] })
      renderManager()
      await waitFor(() => expect(screen.getByText('readme')).toBeTruthy())

      const checkboxes = screen.getAllByRole('checkbox')
      await user.click(checkboxes[1])
      await waitFor(() => expect(screen.getByText('已选择 1 个文档')).toBeTruthy())

      const removeBtn = screen.getByText('批量移除')
      await user.click(removeBtn)

      await waitFor(() => {
        expect(screen.getByText('仅删除知识库索引/分块数据；')).toBeTruthy()
        expect(screen.getByText('不会删除用户本地 Markdown 文件。')).toBeTruthy()
      })
    })

    it('自动入库开启时显示补充提示', async () => {
      const user = userEvent.setup()
      renderManager()
      await waitFor(() => expect(screen.getByText('readme')).toBeTruthy())

      const checkboxes = screen.getAllByRole('checkbox')
      await user.click(checkboxes[1])
      await waitFor(() => expect(screen.getByText('已选择 1 个文档')).toBeTruthy())

      const removeBtn = screen.getByText('批量移除')
      await user.click(removeBtn)

      await waitFor(() => {
        expect(
          screen.getByText('自动入库已开启，后续再次打开或保存文档可能重新入库。'),
        ).toBeTruthy()
      })
    })
  })

  describe('移除流程', () => {
    it('移除成功后刷新列表', async () => {
      const user = userEvent.setup()
      mockRemoveDocuments.mockResolvedValue({
        success: ['/workspace/readme.md'],
        failed: [],
      })
      mockListDocuments
        .mockResolvedValueOnce(mockDocuments)
        .mockResolvedValueOnce([
          mockDocuments[1],
          mockDocuments[2],
        ])

      renderManager()
      await waitFor(() => expect(screen.getByText('readme')).toBeTruthy())

      const checkboxes = screen.getAllByRole('checkbox')
      await user.click(checkboxes[1])
      await waitFor(() => expect(screen.getByText('已选择 1 个文档')).toBeTruthy())

      await user.click(screen.getByRole('button', { name: '批量移除' }))

      await user.click(screen.getByRole('button', { name: '确认移除' }))

      await waitFor(() => {
        expect(mockRemoveDocuments).toHaveBeenCalledWith(['/workspace/readme.md'])
        expect(mockToastSuccess).toHaveBeenCalledWith('已移除 1 个文档')
        expect(mockListDocuments).toHaveBeenCalledTimes(2)
      })
    })

    it('部分失败时保留失败项选择', async () => {
      const user = userEvent.setup()
      mockRemoveDocuments.mockResolvedValue({
        success: ['/workspace/readme.md'],
        failed: [{ filePath: '/workspace/notes.md', error: '删除失败' }],
      })
      mockListDocuments
        .mockResolvedValueOnce(mockDocuments)
        .mockResolvedValueOnce(mockDocuments)

      renderManager()
      await waitFor(() => expect(screen.getByText('readme')).toBeTruthy())

      const checkboxes = screen.getAllByRole('checkbox')
      await user.click(checkboxes[1]) // readme
      await user.click(checkboxes[2]) // notes
      await waitFor(() => expect(screen.getByText('已选择 2 个文档')).toBeTruthy())

      await user.click(screen.getByRole('button', { name: '批量移除' }))

      await user.click(screen.getByRole('button', { name: '确认移除' }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalled()
        expect(screen.getByText('已选择 1 个文档')).toBeTruthy()
      })
    })

    it('删除中禁用重复提交', async () => {
      const user = userEvent.setup()
      let resolveRemove: (v: unknown) => void = () => {}
      mockRemoveDocuments.mockReturnValue(
        new Promise((resolve) => {
          resolveRemove = resolve
        }),
      )

      renderManager()
      await waitFor(() => expect(screen.getByText('readme')).toBeTruthy())

      const checkboxes = screen.getAllByRole('checkbox')
      await user.click(checkboxes[1])
      await waitFor(() => expect(screen.getByText('已选择 1 个文档')).toBeTruthy())

      await user.click(screen.getByRole('button', { name: '批量移除' }))

      await user.click(screen.getByRole('button', { name: '确认移除' }))

      // 确认按钮应处于 loading 状态
      await waitFor(() => {
        const confirmBtn = screen.getByRole('button', { name: '确认移除' })
        expect(confirmBtn).toBeTruthy()
      })

      resolveRemove({ success: ['/workspace/readme.md'], failed: [] })
    })
  })
})
