/**
 * Modal to notify user about legacy IndexedDB data.
 * Shown once when legacy data is first detected.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from 'animal-island-ui'
import { toast } from '@/services/toast'
import {
  markLegacyDetected,
  getSqliteDatabasePath,
  getLegacyIndexedDBPath,
  generateMigrationPrompt,
  type LegacyDetectionResult,
} from '@/services/database/legacyDetector'
import { GITHUB_REPOSITORY_URL } from '@/services/updateService'

interface LegacyDataNoticeModalProps {
  detection: LegacyDetectionResult
  onClose: () => void
}

export function LegacyDataNoticeModal({ detection, onClose }: LegacyDataNoticeModalProps) {
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const closeTimerRef = useRef<number>()
  const [copying, setCopying] = useState(false)

  const requestClose = useCallback(async () => {
    if (closingRef.current) return

    // Mark as noticed before closing
    try {
      await markLegacyDetected()
    } catch {
      // Continue closing even if persist fails
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose()
      return
    }

    closingRef.current = true
    setClosing(true)
    closeTimerRef.current = window.setTimeout(onClose, 160)
  }, [onClose])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  const handleCopyPrompt = async () => {
    setCopying(true)
    try {
      const prompt = generateMigrationPrompt(
        { documents: 0, chat_sessions: 0, chat_messages: 0, memories: 0 },
        detection.detectedCounts || { documents: 0, chat_sessions: 0, chat_messages: 0, memories: 0 },
      )
      await navigator.clipboard.writeText(prompt)
      toast.success('已复制到剪贴板')
    } catch {
      toast.error('复制失败，请手动复制')
    } finally {
      setTimeout(() => setCopying(false), 1000)
    }
  }

  const handleOpenReleases = async () => {
    const url = `${GITHUB_REPOSITORY_URL}/releases`
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(url)
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div
      data-closing={closing || undefined}
      className="gm-legacy-modal-scrim fixed inset-0 z-[1100] flex items-center justify-center bg-black/45 p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legacy-notice-title"
    >
      <div
        className="gm-legacy-modal-dialog w-full max-w-md rounded-2xl border border-gm-border bg-gm-surface shadow-2xl"
      >
        {/* Header */}
        <header className="border-b border-gm-border px-5 py-4">
          <h2 id="legacy-notice-title" className="text-heading font-bold text-gm-text">
            检测到旧版数据需要迁移
          </h2>
          <p className="mt-1.5 text-caption text-gm-text-secondary leading-relaxed">
            此前观墨采用「SQLite 为主、IndexedDB 兜底」的双库保障方案。为简化架构、便于后续业务迭代，现已切换为仅 SQLite。
            <br />
            旧版 IndexedDB 中的数据需要迁移到新库，推荐复制下方提示词交给 AI 操作，成功率更高；也可下载迁移脚本自行处理。
            <br />
            感谢配合，如有疑问请反馈至 GitHub。
          </p>
        </header>

        {/* Content */}
        <div className="px-5 py-4">
          {/* Database paths */}
          <div className="space-y-2">
            <div>
              <p className="text-micro font-bold text-gm-text-tertiary uppercase tracking-wider">
                SQLite（当前）
              </p>
              <code className="mt-1 block text-caption text-gm-text-secondary bg-gm-surface-elevated px-2 py-1 rounded">
                {getSqliteDatabasePath()}
              </code>
            </div>
            <div>
              <p className="text-micro font-bold text-gm-text-tertiary uppercase tracking-wider">
                IndexedDB（旧版）
              </p>
              <code className="mt-1 block text-caption text-gm-text-secondary bg-gm-surface-elevated px-2 py-1 rounded">
                {getLegacyIndexedDBPath()}
              </code>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-5 pb-5">
          <Button
            type="default"
            block
            loading={copying}
            onClick={handleCopyPrompt}
          >
            复制 AI 提示词
          </Button>
          <Button
            type="primary"
            block
            onClick={handleOpenReleases}
          >
            下载迁移工具
          </Button>
        </div>

        {/* Close link */}
        <div className="border-t border-gm-border px-5 py-3">
          <Button
            type="text"
            block
            onClick={requestClose}
          >
            我知道了
          </Button>
        </div>
      </div>
    </div>
  )
}
