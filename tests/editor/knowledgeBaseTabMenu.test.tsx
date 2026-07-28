import { describe, expect, it, vi } from 'vitest'
import { isMarkdownPath } from '@/services/rag/indexer'
import { addKnowledgeDocument } from '@/services/rag/knowledgeBase'

describe('知识库标签菜单', () => {
  describe('isMarkdownPath', () => {
    it('正确识别 .md 文件', () => {
      expect(isMarkdownPath('/path/to/file.md')).toBe(true)
    })

    it('正确识别 .markdown 文件', () => {
      expect(isMarkdownPath('/path/to/file.markdown')).toBe(true)
    })

    it('正确识别 .mdx 文件', () => {
      expect(isMarkdownPath('/path/to/file.mdx')).toBe(true)
    })

    it('正确识别大小写不敏感的扩展名', () => {
      expect(isMarkdownPath('/path/to/file.MD')).toBe(true)
    })

    it('拒绝非 Markdown 文件', () => {
      expect(isMarkdownPath('/path/to/file.txt')).toBe(false)
      expect(isMarkdownPath('/path/to/file.pdf')).toBe(false)
    })

    it('拒绝空路径', () => {
      expect(isMarkdownPath('')).toBe(false)
    })
  })

  describe('addKnowledgeDocument 参数校验', () => {
    it('非 Markdown 路径返回失败', async () => {
      const result = await addKnowledgeDocument({
        filePath: '/path/to/file.txt',
        title: 'test',
        content: 'content',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe('非 Markdown 文件或路径为空')
    })

    it('空路径返回失败', async () => {
      const result = await addKnowledgeDocument({
        filePath: '',
        title: 'test',
        content: 'content',
      })
      expect(result.success).toBe(false)
    })
  })
})

describe('autoIndexEnabled 默认值', () => {
  it('知识库设置默认开启自动入库', async () => {
    // 重置模块以获取干净的 store
    vi.resetModules()
    localStorage.clear()
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const state = useSettingsStore.getState()
    expect(state.knowledge).toBeDefined()
    expect(state.knowledge.autoIndexEnabled).toBe(true)
  })

  it('updateKnowledgeSettings 可关闭自动入库', async () => {
    vi.resetModules()
    localStorage.clear()
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const store = useSettingsStore
    store.getState().updateKnowledgeSettings({ autoIndexEnabled: false })
    expect(store.getState().knowledge.autoIndexEnabled).toBe(false)
  })

  it('updateKnowledgeSettings 可重新开启自动入库', async () => {
    vi.resetModules()
    localStorage.clear()
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const store = useSettingsStore
    store.getState().updateKnowledgeSettings({ autoIndexEnabled: false })
    expect(store.getState().knowledge.autoIndexEnabled).toBe(false)
    store.getState().updateKnowledgeSettings({ autoIndexEnabled: true })
    expect(store.getState().knowledge.autoIndexEnabled).toBe(true)
  })
})