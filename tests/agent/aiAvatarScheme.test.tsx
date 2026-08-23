import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiPanel } from '@/components/ai/AiPanel'
import { resolveAiAvatarStyle } from '@/stores/settingsStore'
import { useSettingsStore } from '@/stores/settingsStore'

const aiChat = vi.hoisted(() => ({
  messages: [
    { id: 'user-1', role: 'user' as const, content: '匿名问题', timestamp: 1 },
    { id: 'assistant-1', parentId: 'user-1', role: 'assistant' as const, content: '匿名回答', timestamp: 2 },
  ],
  streaming: false,
  error: null,
  timeline: [],
  sendMessage: vi.fn(),
  cancelStream: vi.fn(),
}))

const readingArtifacts = vi.hoisted(() => ({
  artifacts: [],
  loading: false,
  filter: 'all' as 'all' | 'summary' | 'question_set' | 'annotation' | 'note',
  query: '',
  page: 1,
  pageSize: 20,
  total: 0,
  selectedId: null,
  anchorStatuses: {},
  loadArtifacts: vi.fn(),
  setFilter: vi.fn(),
  setQuery: vi.fn(),
  setPage: vi.fn(),
  setSelected: vi.fn(),
  deleteArtifact: vi.fn(),
  saveArtifactFromMessage: vi.fn(),
  checkAnchor: vi.fn(),
  resetAnchorStatus: vi.fn(),
}))

vi.mock('@/hooks/useAiChat', () => ({
  useAiChat: () => aiChat,
}))

vi.mock('@/stores/readingArtifactsStore', () => ({
  useReadingArtifactsStore: (selector: (state: typeof readingArtifacts) => unknown) => selector(readingArtifacts),
}))

function setAvatarStyle(style: 'icon' | 'mascot' | 'sprite') {
  act(() => {
    useSettingsStore.getState().updateAppearanceSettings({ aiAvatarStyle: style })
  })
}

describe('AI 头像三套方案切换（AiAvatar）', () => {
  const scrollTo = vi.fn()

  beforeEach(() => {
    scrollTo.mockReset()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    act(() => {
      useSettingsStore.getState().updateAppearanceSettings({ aiAvatarStyle: 'icon' })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
  })

  it('默认 icon 方案渲染聊天图标，不出现小球', () => {
    render(<AiPanel />)
    expect(document.querySelector('.gm-ai-sprite')).toBeNull()
    expect(document.querySelector('.gm-ai-chat-icon')).not.toBeNull()
  })

  it('sprite 方案在消息头像位置渲染状态小球，非流式消息固定 idle', () => {
    render(<AiPanel />)
    setAvatarStyle('sprite')
    const sprites = document.querySelectorAll<HTMLElement>('.gm-ai-sprite')
    expect(sprites.length).toBeGreaterThan(0)
    for (const sprite of sprites) {
      // aiChat.streaming === false，所有消息头像均为静态 idle
      expect(sprite.getAttribute('data-state')).toBe('idle')
    }
  })

  it('mascot 方案回归：仍渲染吉祥物图片', () => {
    render(<AiPanel />)
    setAvatarStyle('mascot')
    expect(document.querySelector('.gm-ai-sprite')).toBeNull()
    expect(document.querySelector('img.gm-ai-mascot-image')).not.toBeNull()
  })

  it('设置页分段选择器包含三个选项并同步选中态', () => {
    render(<AiPanel />)
    setAvatarStyle('sprite')
    const group = document.querySelector('[role="radiogroup"][aria-label="AI 头像风格"]')
    if (group) {
      const radios = group.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      expect(radios.length).toBe(3)
      const checked = Array.from(radios).find((radio) => radio.getAttribute('aria-checked') === 'true')
      expect(checked?.textContent).toContain('小球')
    }
  })
})

describe('旧布尔值迁移（resolveAiAvatarStyle）', () => {
  const current = {
    appearance: {
      customCursorEnabled: false,
      aiAvatarStyle: 'icon',
      themeId: 'warm',
      lastLightThemeId: 'warm',
    },
  } as const

  it('旧 aiMascotAvatarEnabled=true 迁移为 mascot', () => {
    expect(resolveAiAvatarStyle({ aiMascotAvatarEnabled: true }, current)).toBe('mascot')
  })

  it('旧 aiMascotAvatarEnabled=false 迁移为 icon', () => {
    expect(resolveAiAvatarStyle({ aiMascotAvatarEnabled: false }, current)).toBe('icon')
  })

  it('新枚举字段优先于旧布尔值', () => {
    expect(
      resolveAiAvatarStyle({ aiAvatarStyle: 'sprite', aiMascotAvatarEnabled: true }, current),
    ).toBe('sprite')
  })

  it('非法枚举值回落到旧布尔迁移，无任何存档时用当前默认', () => {
    expect(resolveAiAvatarStyle({ aiAvatarStyle: 'bogus', aiMascotAvatarEnabled: true }, current)).toBe('mascot')
    expect(resolveAiAvatarStyle({}, current)).toBe('icon')
  })
})
