/**
 * 会话恢复合并契约测试
 *
 * 验证 docs/architecture/state-ownership.md 第 2 节 Invariant：
 * 恢复会话合并 Tab 时不得丢失未保存草稿。策略实现见
 * src/services/sessionRestorePolicy.ts 的 mergeBackgroundRestoredTab：
 * - 启动后未修改 → 整体采纳磁盘恢复内容；
 * - 有未保存草稿 → 保留草稿 content，仅更新 savedContent 基线并重算 modified；
 * - Tab id / filePath 不匹配 → 安全 no-op；
 * - 未修改但本会话已保存 → 保留当前状态；
 * - 合并只影响目标 Tab。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { useEditorStore, type Tab } from '@/stores/editorStore'

function makeTab(id: string, text: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    title: `匿名文档 ${id}`,
    filePath: `X:\\anon\\${id}.md`,
    content: text,
    savedContent: text,
    originalContent: text,
    modified: false,
    ...overrides,
  }
}

describe('会话恢复合并契约（invariants 见 docs/architecture/state-ownership.md）', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: [],
      activeTabId: null,
      rightPaneTabId: null,
      previewSwitchingTabId: null,
    })
  })

  it('启动后未修改的 Tab 整体采纳磁盘恢复内容', () => {
    const original = makeTab('merge-a', '启动时内容')
    const restored = makeTab('merge-a', '磁盘新内容')
    useEditorStore.setState({ tabs: [original], activeTabId: 'merge-a' })

    useEditorStore.getState().mergeRestoredTab(original, restored)

    expect(useEditorStore.getState().tabs[0]).toEqual(restored)
  })

  it('未保存草稿优先：保留草稿内容，仅更新 savedContent 基线并保持 modified', () => {
    const original = makeTab('merge-a', '启动时内容')
    const draft = makeTab('merge-a', '启动时内容', { content: '我的未保存草稿', modified: true })
    const restored = makeTab('merge-a', '磁盘新内容')
    useEditorStore.setState({ tabs: [draft], activeTabId: 'merge-a' })

    useEditorStore.getState().mergeRestoredTab(original, restored)

    const tab = useEditorStore.getState().tabs[0]
    expect(tab.content).toBe('我的未保存草稿')
    expect(tab.savedContent).toBe('磁盘新内容')
    expect(tab.originalContent).toBe('启动时内容')
    expect(tab.modified).toBe(true)
  })

  it('草稿与磁盘恢复内容一致时，合并后 modified 归位为 false', () => {
    const original = makeTab('merge-a', '启动时内容')
    const draft = makeTab('merge-a', '启动时内容', { content: '磁盘新内容', modified: true })
    const restored = makeTab('merge-a', '磁盘新内容')
    useEditorStore.setState({ tabs: [draft], activeTabId: 'merge-a' })

    useEditorStore.getState().mergeRestoredTab(original, restored)

    const tab = useEditorStore.getState().tabs[0]
    expect(tab.content).toBe('磁盘新内容')
    expect(tab.savedContent).toBe('磁盘新内容')
    expect(tab.modified).toBe(false)
  })

  it('filePath 不匹配时安全 no-op，不用恢复内容覆盖当前 Tab', () => {
    const original = makeTab('merge-a', '启动时内容')
    const current = makeTab('merge-a', '启动时内容', { content: '当前内容', modified: true })
    const restored = makeTab('merge-a', '磁盘新内容')
    useEditorStore.setState({ tabs: [current], activeTabId: 'merge-a' })

    // original 与 store 中当前 Tab 的 filePath 不一致（例如期间发生了重命名）
    const renamedOriginal = { ...original, filePath: 'X:\\anon\\renamed.md' }
    useEditorStore.getState().mergeRestoredTab(renamedOriginal, restored)

    const tab = useEditorStore.getState().tabs[0]
    expect(tab.content).toBe('当前内容')
    expect(tab.savedContent).toBe('启动时内容')
    expect(tab.modified).toBe(true)
  })

  it('未修改但本会话已保存的 Tab 保留当前状态，不被恢复内容覆盖', () => {
    const original = makeTab('merge-a', '启动时内容')
    const savedInSession = makeTab('merge-a', '启动时内容', {
      content: '会话中保存的内容',
      savedContent: '会话中保存的内容',
    })
    const restored = makeTab('merge-a', '磁盘新内容')
    useEditorStore.setState({ tabs: [savedInSession], activeTabId: 'merge-a' })

    useEditorStore.getState().mergeRestoredTab(original, restored)

    const tab = useEditorStore.getState().tabs[0]
    expect(tab.content).toBe('会话中保存的内容')
    expect(tab.savedContent).toBe('会话中保存的内容')
  })

  it('合并只影响目标 Tab，其他 Tab 保持不变', () => {
    const original = makeTab('merge-a', '启动时内容')
    const other = makeTab('merge-b', '另一个文档内容')
    const restored = makeTab('merge-a', '磁盘新内容')
    useEditorStore.setState({ tabs: [original, other], activeTabId: 'merge-a' })

    useEditorStore.getState().mergeRestoredTab(original, restored)

    const tabs = useEditorStore.getState().tabs
    expect(tabs[0].content).toBe('磁盘新内容')
    expect(tabs[1]).toEqual(other)
  })
})
