/**
 * Settings page entry for legacy data migration.
 * Simple detection button with result display below.
 */

import { useState } from 'react'
import { Button } from 'animal-island-ui'
import { toast } from '@/services/toast'
import {
  detectLegacyData,
  getSqliteDatabasePath,
  getLegacyIndexedDBPath,
  generateMigrationPrompt,
  type LegacyDetectionResult,
} from '@/services/database/legacyDetector'
import { GITHUB_REPOSITORY_URL } from '@/services/updateService'

export function LegacyMigrationEntry() {
  const [detection, setDetection] = useState<LegacyDetectionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [copying, setCopying] = useState(false)

  const handleDetect = async () => {
    setLoading(true)
    try {
      const result = await detectLegacyData()
      setDetection(result)
    } catch {
      toast.error('检测失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCopyPrompt = async () => {
    setCopying(true)
    try {
      const prompt = generateMigrationPrompt(
        { documents: 0, chat_sessions: 0, chat_messages: 0, memories: 0 },
        detection?.detectedCounts || { documents: 0, chat_sessions: 0, chat_messages: 0, memories: 0 },
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
    <div className="space-y-3">
      {/* Detection button */}
      <div className="rounded-xl border border-gm-border bg-gm-surface-elevated px-3 py-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-body text-gm-text">旧版数据迁移</p>
            <p className="text-caption text-gm-text-tertiary mt-0.5">
              此前采用「SQLite 为主、IndexedDB 兜底」双库方案，现为便于业务迭代已切换为仅 SQLite，旧数据需迁移
            </p>
          </div>
          <Button
            type="default"
            size="small"
            loading={loading}
            onClick={handleDetect}
          >
            检测旧数据
          </Button>
        </div>
      </div>

      {/* Result display */}
      {detection && (
        <div className="rounded-xl border border-gm-border bg-gm-surface-elevated px-3 py-3">
          {!detection.legacyDetected ? (
            <p className="text-body text-gm-text">未检测到旧版数据</p>
          ) : (
            <div className="space-y-3">
              <p className="text-body text-gm-text leading-relaxed">
                检测到旧版 IndexedDB 数据。推荐复制提示词交给 AI 操作（成功率更高），也可下载迁移脚本自行处理。感谢配合。
              </p>

              {/* Paths */}
              <div className="space-y-1">
                <div>
                  <p className="text-micro font-bold text-gm-text-tertiary uppercase tracking-wider">
                    SQLite（当前）
                  </p>
                  <code className="mt-1 block text-caption text-gm-text-secondary bg-gm-surface px-2 py-1 rounded">
                    {getSqliteDatabasePath()}
                  </code>
                </div>
                <div>
                  <p className="text-micro font-bold text-gm-text-tertiary uppercase tracking-wider">
                    IndexedDB（旧版）
                  </p>
                  <code className="mt-1 block text-caption text-gm-text-secondary bg-gm-surface px-2 py-1 rounded">
                    {getLegacyIndexedDBPath()}
                  </code>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  type="default"
                  size="small"
                  loading={copying}
                  onClick={handleCopyPrompt}
                >
                  复制 AI 提示词
                </Button>
                <Button
                  type="primary"
                  size="small"
                  onClick={handleOpenReleases}
                >
                  下载迁移工具
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
