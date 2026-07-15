import { useEffect, useRef } from 'react'
import { Button } from 'animal-island-ui'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'
import { toast } from '@/services/toast'
import { openReleaseInSystemBrowser } from '@/services/updateService'
import { useUpdateStore } from '@/stores/updateStore'

export function UpdateDetailsModal() {
  const update = useUpdateStore((state) => state.selectedUpdate)
  const closeDetails = useUpdateStore((state) => state.closeDetails)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!update) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetails()
    }
    window.addEventListener('keydown', handleKeyDown)
    closeButtonRef.current?.focus()
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeDetails, update])

  if (!update) return null

  const publishedAt = Number.isNaN(Date.parse(update.release.published_at))
    ? update.release.published_at
    : new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(update.release.published_at))

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeDetails()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-details-title"
        className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gm-border bg-gm-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gm-border px-5 py-4">
          <div>
            <h2 id="update-details-title" className="text-heading font-bold text-gm-text">发现新版本</h2>
            <p className="mt-1 text-caption text-gm-text-tertiary">观墨已有新版本可供下载</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeDetails}
            aria-label="关闭更新详情"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gm-text-tertiary transition-colors hover:bg-gm-surface-hover hover:text-gm-text"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-5 grid gap-2 sm:grid-cols-3">
            <VersionMeta label="最新版本" value={`v${update.latestVersion}`} />
            <VersionMeta label="当前版本" value={`v${update.currentVersion}`} />
            <VersionMeta label="发布时间" value={publishedAt} />
          </div>
          <h3 className="mb-2 text-body font-bold text-gm-text">更新说明</h3>
          <MarkdownPreview
            content={update.release.body?.trim() || '本次发布暂无详细说明。'}
            skipHtml
          />
        </div>

        <footer className="flex shrink-0 justify-end border-t border-gm-border px-5 py-4">
          <Button
            type="primary"
            onClick={() => {
              void openReleaseInSystemBrowser(update.release.html_url).catch((error) => {
                toast.error(error instanceof Error ? error.message : '打开下载页面失败')
              })
            }}
          >
            前往 GitHub 下载
          </Button>
        </footer>
      </section>
    </div>
  )
}

function VersionMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gm-border bg-gm-surface-elevated px-3 py-2.5">
      <div className="text-micro text-gm-text-tertiary">{label}</div>
      <div className="mt-1 break-words text-caption font-bold text-gm-text">{value}</div>
    </div>
  )
}
