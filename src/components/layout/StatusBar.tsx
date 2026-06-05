import { useMemo } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { Divider } from 'animal-island-ui'

export function StatusBar() {
  const { tabs, activeTabId } = useEditorStore()
  const { ai } = useSettingsStore()

  const activeTab = tabs.find((t) => t.id === activeTabId)

  const wordCount = useMemo(() => {
    if (!activeTab?.content) return 0
    const text = activeTab.content.trim()
    if (!text) return 0
    const chineseChars = text.match(/[一-鿿]/g)?.length || 0
    const englishWords = text.replace(/[一-鿿]/g, ' ').split(/\s+/).filter(Boolean).length
    return chineseChars + englishWords
  }, [activeTab?.content])

  const aiConfigured = ai.apiKey.length > 0

  return (
    <div className="h-8 flex items-center px-4 bg-gm-surface border-t border-gm-border-subtle text-caption text-gm-text-secondary gap-4">
      {/* Left */}
      <StatusItem>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
        <span>{activeTab?.filePath ? activeTab.title : '未打开文件'}</span>
      </StatusItem>

      <div className="flex-1" />

      {/* Right */}
      {activeTab && (
        <>
          <StatusItem>
            <span>UTF-8</span>
          </StatusItem>
          <StatusItem>
            <span>{wordCount} 词</span>
          </StatusItem>
          {activeTab.modified && (
            <StatusItem>
              <span className="text-gm-primary font-bold">已修改</span>
            </StatusItem>
          )}
          <StatusDivider />
        </>
      )}

      <StatusItem className="gap-1.5">
        <div className={`w-2 h-2 rounded-full ${aiConfigured ? 'bg-gm-success' : 'bg-gm-text-disabled'}`} />
        <span>{aiConfigured ? 'AI 就绪' : 'AI 未配置'}</span>
      </StatusItem>
    </div>
  )
}

function StatusItem({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={`flex items-center gap-1.5 select-none cursor-default hover:text-gm-text transition-colors ${className}`}>
      {children}
    </span>
  )
}

function StatusDivider() {
  return <span className="w-px h-3 bg-gm-border" />
}
