import assert from 'node:assert/strict'
import type { Tab } from '@/stores/editorStore'
import { mergeBackgroundRestoredTab, restorePersistedTabs } from '@/services/sessionRestore'

function tab(id: string, content = ''): Tab {
  return {
    id,
    title: id,
    filePath: `D:\\notes\\${id}.md`,
    content,
    savedContent: content,
    originalContent: content,
    modified: false,
  }
}

async function run() {
  const starts: string[] = []
  let releaseSlow: (() => void) | undefined
  const slow = new Promise<void>((resolve) => { releaseSlow = resolve })

  const restoring = restorePersistedTabs(
    [tab('slow'), tab('active'), tab('third')],
    {
      activeTabId: 'active',
      concurrency: 2,
      readFile: async (path) => {
        const id = path.split('\\').at(-1)?.replace('.md', '') ?? ''
        starts.push(id)
        if (id === 'slow') await slow
        return `${id}-disk`
      },
    }
  )

  await Promise.resolve()
  assert.equal(starts[0], 'active', '活动标签必须最先开始恢复')
  assert.ok(starts.length <= 2, '后台恢复不得超过配置的并发上限')
  releaseSlow?.()
  const restored = await restoring
  assert.deepEqual(restored.map((item) => item.id), ['slow', 'active', 'third'], '恢复后保持标签顺序')

  const draft = tab('draft', 'unsaved draft')
  draft.modified = true
  const [restoredDraft] = await restorePersistedTabs([draft], {
    readFile: async () => 'saved on disk',
  })
  assert.equal(restoredDraft.content, 'unsaved draft', '未保存草稿内容不得被磁盘内容覆盖')
  assert.equal(restoredDraft.savedContent, 'saved on disk')
  assert.equal(restoredDraft.modified, true)

  const legacy = { ...tab('legacy'), originalContent: undefined } as unknown as Tab
  const [restoredLegacy] = await restorePersistedTabs([legacy], {
    readFile: async () => 'legacy disk',
  })
  assert.equal(restoredLegacy.originalContent, 'legacy disk', '旧版持久化标签应补齐 originalContent')
  const legacyDraft = { ...tab('legacy-draft', 'draft'), filePath: null, originalContent: undefined } as unknown as Tab
  const [restoredLegacyDraft] = await restorePersistedTabs([legacyDraft])
  assert.equal(restoredLegacyDraft.originalContent, 'draft', '旧版无路径草稿也应补齐 originalContent')

  const original = tab('editing', '')
  const current = { ...original, content: 'typed after UI ready', modified: true }
  const diskRestored = { ...original, content: 'disk', savedContent: 'disk', originalContent: 'disk' }
  const merged = mergeBackgroundRestoredTab(current, original, diskRestored)
  assert.equal(merged.content, 'typed after UI ready', '后台恢复不得覆盖 UI 就绪后的输入')
  assert.equal(merged.savedContent, 'disk')
  assert.equal(merged.modified, true)

  console.log('session restore checks passed')
}

await run()
