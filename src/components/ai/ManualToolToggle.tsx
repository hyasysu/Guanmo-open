import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/vendor/animal-island-ui'

export type ManualCapability = 'knowledge' | 'memory' | 'web'

interface ManualToolToggleProps {
  onChange: (capabilities: ManualCapability[]) => void
  onReasoningModeChange?: (mode: 'off' | 'on') => void
  disabled?: boolean
  resetKey?: number // 用于外部触发重置
}

export function ManualToolToggle({ onChange, onReasoningModeChange, disabled = false, resetKey }: ManualToolToggleProps) {
  const [reasoningMode, setReasoningMode] = useState<'off' | 'on'>('off')

  // 外部触发重置
  useEffect(() => {
    if (resetKey !== undefined) {
      setReasoningMode('off')
    }
  }, [resetKey])

  const toggleReasoning = useCallback(() => {
    if (disabled) return
    const newMode = reasoningMode === 'off' ? 'on' : 'off'
    setReasoningMode(newMode)
    onReasoningModeChange?.(newMode)
  }, [disabled, reasoningMode, onReasoningModeChange])

  return (
    <div className="flex items-center gap-1.5 px-2 pt-0.5 pb-1">
      <div className="relative group">
        <Button
          type="default"
          size="small"
          disabled={disabled}
          onClick={toggleReasoning}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
              <path d="M12 6v6l4 2" />
            </svg>
          }
          className={`
            gm-manual-tool-toggle !px-2 !py-1 !h-7 !text-micro !font-medium !rounded-2xl
            ${reasoningMode === 'on'
              ? 'gm-manual-tool-toggle--active'
              : ''
            }
          `}
        >
          深度思考
        </Button>
        {/* Tooltip */}
        <div className="gm-manual-tool-tooltip absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-lg text-micro whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
          {reasoningMode === 'on' ? '已开启深度思考（仅本次请求）' : '开启深度思考模式，AI 将进行更深入的推理'}
        </div>
      </div>
    </div>
  )
}
