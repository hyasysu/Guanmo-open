import { useEffect, useState } from 'react'
import { useAssistantState } from '@/hooks/useAssistantState'
import { ASSISTANT_STATE_LABELS, type AssistantState } from '@/services/assistantState'

interface AiSpriteProps {
  /** 覆盖展示状态（如历史消息头像固定 idle）；缺省时跟随全局 AI 助手状态 */
  state?: AssistantState
  /** 是否播放状态动作；历史消息头像应关闭动画 */
  animated?: boolean
  size?: number
  className?: string
}

/**
 * AI 状态小球：简约圆球与两枚眼睛，纯展示组件。
 * 所有动画由 global.css 中 .gm-ai-sprite 规则按 data-state 驱动。
 */
export function AiSprite({ state, animated = true, size = 32, className = '' }: AiSpriteProps) {
  const liveState = useAssistantState()
  const current = state ?? liveState
  const [paused, setPaused] = useState(() => document.visibilityState === 'hidden')

  useEffect(() => {
    const handleVisibilityChange = () => {
      setPaused(document.visibilityState === 'hidden')
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return (
    <span
      className={`gm-ai-sprite ${className}`.trim()}
      role="img"
      aria-label={ASSISTANT_STATE_LABELS[current]}
      data-state={current}
      data-animated={animated ? 'true' : 'false'}
      data-paused={paused ? 'true' : undefined}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <defs>
          <radialGradient id="gmAiSpriteBodyFill" cx="30%" cy="24%" r="78%">
            <stop offset="0%" stopColor="var(--gm-sprite-body-highlight)" />
            <stop offset="44%" stopColor="var(--gm-sprite-body)" />
            <stop offset="100%" stopColor="var(--gm-sprite-body-shadow)" />
          </radialGradient>
        </defs>

        <g className="gm-ai-sprite__core">
          <circle className="gm-ai-sprite__body" cx="32" cy="32" r="23" fill="url(#gmAiSpriteBodyFill)" stroke="var(--gm-sprite-stroke)" strokeWidth="1.5" />

          <g className="gm-ai-sprite__face">
            <ellipse className="gm-ai-sprite__eye" cx="24.5" cy="31.5" rx="3.1" ry="4.3" fill="var(--gm-sprite-face)" />
            <ellipse className="gm-ai-sprite__eye" cx="39.5" cy="31.5" rx="3.1" ry="4.3" fill="var(--gm-sprite-face)" />
          </g>
        </g>
      </svg>
    </span>
  )
}
