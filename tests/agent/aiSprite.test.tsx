import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AiSprite } from '@/components/ai/AiSprite'
import {
  ASSISTANT_STATE_LABELS,
  __resetAssistantStateForTests,
  type AssistantState,
} from '@/services/assistantState'
import { useChatStore } from '@/stores/chatStore'

const ALL_STATES: AssistantState[] = [
  'idle',
  'reading',
  'retrieving',
  'searching',
  'thinking',
  'generating',
  'success',
  'error',
]

function setDocumentVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  })
}

describe('AI 状态小球（AiSprite）', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      streaming: false,
      error: null,
      ragStatus: 'idle',
      timeline: [],
    })
    __resetAssistantStateForTests()
    setDocumentVisibility('visible')
  })

  afterEach(() => {
    __resetAssistantStateForTests()
    setDocumentVisibility('visible')
  })

  it.each(ALL_STATES)('渲染 %s 状态的 data-state 与 aria-label', (state) => {
    const { container } = render(<AiSprite state={state} size={30} />)
    const root = container.querySelector<HTMLElement>('.gm-ai-sprite')!
    expect(root).not.toBeNull()
    expect(root.getAttribute('data-state')).toBe(state)
    expect(root.getAttribute('aria-label')).toBe(ASSISTANT_STATE_LABELS[state])
    expect(root.getAttribute('role')).toBe('img')
  })

  it('SVG 只保留圆球和两枚眼睛，动画交给 CSS 控制', () => {
    const { container } = render(<AiSprite state="idle" />)
    expect(container.querySelector('.gm-ai-sprite__core')).not.toBeNull()
    expect(container.querySelector('.gm-ai-sprite__body')).not.toBeNull()
    expect(container.querySelectorAll('.gm-ai-sprite__eye')).toHaveLength(2)
    expect(container.querySelector('.gm-ai-sprite__mouth')).toBeNull()
    expect(container.querySelector('.gm-ai-sprite__orbit')).toBeNull()
    expect(container.querySelector('.gm-ai-sprite__pulse')).toBeNull()
    expect(container.querySelector('.gm-ai-sprite__dot')).toBeNull()
  })

  it('animated=false 时标记为静态头像', () => {
    const { container } = render(<AiSprite state="idle" animated={false} />)
    expect(container.querySelector('.gm-ai-sprite')?.getAttribute('data-animated')).toBe('false')
  })

  it('未显式传入 state 时跟随全局助手状态实时变化', () => {
    const { container } = render(<AiSprite size={30} />)
    const root = container.querySelector<HTMLElement>('.gm-ai-sprite')!
    expect(root.getAttribute('data-state')).toBe('idle')

    act(() => {
      useChatStore.getState().setStreaming(true)
    })
    expect(root.getAttribute('data-state')).toBe('reading')
  })

  it('页面隐藏时标记 data-paused，恢复可见后解除', () => {
    const { container } = render(<AiSprite state="generating" />)
    const root = container.querySelector<HTMLElement>('.gm-ai-sprite')!
    expect(root.hasAttribute('data-paused')).toBe(false)

    setDocumentVisibility('hidden')
    fireEvent(document, new Event('visibilitychange'))
    expect(root.getAttribute('data-paused')).toBe('true')

    setDocumentVisibility('visible')
    fireEvent(document, new Event('visibilitychange'))
    expect(root.hasAttribute('data-paused')).toBe(false)
  })
})
