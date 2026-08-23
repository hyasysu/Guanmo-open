import { useEffect, useState } from 'react'
import { useAssistantState } from '@/hooks/useAssistantState'
import { ASSISTANT_STATE_LABELS, type AssistantState } from '@/services/assistantState'

interface AiSpriteProps {
  /** 覆盖展示状态（如历史消息头像固定 idle）；缺省时跟随全局 AI 助手状态 */
  state?: AssistantState
  size?: number
  className?: string
}

/**
 * AI 状态小球：原创圆球小脸角色，纯展示组件。
 * 所有动画由 global.css 中 .gm-ai-sprite 规则按 data-state 驱动（仅 transform/opacity）。
 */
export function AiSprite({ state, size = 32, className = '' }: AiSpriteProps) {
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
      data-paused={paused ? 'true' : undefined}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="gmAiSpriteBodyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gm-sprite-body)" />
            <stop offset="100%" stopColor="var(--gm-sprite-body-deep)" />
          </linearGradient>
        </defs>

        {/* retrieving：雷达扩散弧 */}
        <circle className="gm-ai-sprite__pulse" cx="32" cy="34" r="26" stroke="var(--gm-sprite-accent)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="24 140" />
        <circle className="gm-ai-sprite__pulse gm-ai-sprite__pulse--b" cx="32" cy="34" r="26" stroke="var(--gm-sprite-accent)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="24 140" />

        {/* searching：虚线轨道环 */}
        <circle className="gm-ai-sprite__orbit" cx="32" cy="34" r="28.5" stroke="var(--gm-sprite-accent)" strokeWidth="2.5" strokeDasharray="9 8.5" />

        {/* thinking：头顶三点 */}
        <circle className="gm-ai-sprite__dot gm-ai-sprite__dot--1" cx="23.5" cy="7.5" r="2.5" fill="var(--gm-sprite-accent)" />
        <circle className="gm-ai-sprite__dot gm-ai-sprite__dot--2" cx="32" cy="6" r="2.5" fill="var(--gm-sprite-accent)" />
        <circle className="gm-ai-sprite__dot gm-ai-sprite__dot--3" cx="40.5" cy="7.5" r="2.5" fill="var(--gm-sprite-accent)" />

        <g className="gm-ai-sprite__core">
          <circle className="gm-ai-sprite__body" cx="32" cy="34" r="21" fill="url(#gmAiSpriteBodyFill)" stroke="var(--gm-sprite-stroke)" strokeWidth="1.5" />

          <g className="gm-ai-sprite__face">
            {/* 默认圆点眼 */}
            <circle className="gm-ai-sprite__eye" cx="25.5" cy="31" r="2.7" fill="var(--gm-sprite-face)" />
            <circle className="gm-ai-sprite__eye" cx="38.5" cy="31" r="2.7" fill="var(--gm-sprite-face)" />
            {/* success：笑眼 ^^ */}
            <path className="gm-ai-sprite__eyes-happy" d="M22.5 31.5 Q26 27.2 29.5 31.5" stroke="var(--gm-sprite-face)" strokeWidth="2.4" strokeLinecap="round" />
            <path className="gm-ai-sprite__eyes-happy" d="M34.5 31.5 Q38 27.2 41.5 31.5" stroke="var(--gm-sprite-face)" strokeWidth="2.4" strokeLinecap="round" />
            {/* error：平线眼 */}
            <path className="gm-ai-sprite__eyes-flat" d="M22.8 31 H28.2" stroke="var(--gm-sprite-face)" strokeWidth="2.4" strokeLinecap="round" />
            <path className="gm-ai-sprite__eyes-flat" d="M35.8 31 H41.2" stroke="var(--gm-sprite-face)" strokeWidth="2.4" strokeLinecap="round" />
            {/* 默认微笑嘴 */}
            <path className="gm-ai-sprite__mouth" d="M28.5 39.5 Q32 42.8 35.5 39.5" stroke="var(--gm-sprite-face)" strokeWidth="2.4" strokeLinecap="round" />
            {/* generating：o 形嘴 */}
            <circle className="gm-ai-sprite__mouth-o" cx="32" cy="40.5" r="2.8" fill="var(--gm-sprite-face)" />
          </g>

          {/* success：微光星芒 */}
          <path
            className="gm-ai-sprite__spark"
            d="M48 12 L50 16.5 L54.5 18.5 L50 20.5 L48 25 L46 20.5 L41.5 18.5 L46 16.5 Z"
            fill="var(--gm-sprite-success)"
          />
        </g>
      </svg>
    </span>
  )
}
