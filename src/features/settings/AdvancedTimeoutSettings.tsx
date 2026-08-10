import { useId, useState } from 'react'
import { SettingSlider } from '@/components/common/SettingSlider'
import {
  REQUEST_TIMEOUT_MAX_MS,
  REQUEST_TIMEOUT_MIN_MS,
  normalizeRequestTimeoutMs,
} from '@/services/requestTimeout'

export function AdvancedTimeoutSettings({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()

  return (
    <div className="my-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        className="inline-flex items-center gap-1 py-2 text-caption text-gm-text-tertiary transition-colors hover:text-gm-text-secondary"
        onClick={() => setExpanded((current) => !current)}
      >
        <span>高级设置</span>
        <svg
          viewBox="0 0 20 20"
          width="14"
          height="14"
          aria-hidden="true"
          className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded && (
        <div id={contentId} className="gm-setting-field flex min-h-[42px] items-center justify-between pb-2">
          <div className="pr-6" style={{ width: 260, flexShrink: 0 }}>
            <span className="text-body text-gm-text">请求超时</span>
            <p className="mt-0.5 text-caption text-gm-text-tertiary">单次 API 请求允许等待的最长时间</p>
          </div>
          <SettingSlider
            label="请求超时"
            value={normalizeRequestTimeoutMs(value) / 1000}
            min={REQUEST_TIMEOUT_MIN_MS / 1000}
            max={REQUEST_TIMEOUT_MAX_MS / 1000}
            step={5}
            onChange={(seconds) => onChange(seconds * 1000)}
            format={(seconds) => `${seconds} 秒`}
            className="gm-setting-control flex-1"
          />
        </div>
      )}
    </div>
  )
}
