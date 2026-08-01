import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decideResource,
  getNextPrewarmTarget,
  MODE_PREWARM_HUGE_DOC_LENGTH,
  BALANCED_LARGE_DOC_THRESHOLD,
  BALANCED_SMALL_DOC_TTL_MS,
  BALANCED_LARGE_DOC_TTL_MS,
  type ResourceDecisionInput,
  type PrewarmTargetMode,
} from '@/services/editorSession'

function baseInput(overrides: Partial<ResourceDecisionInput> = {}): ResourceDecisionInput {
  return {
    policy: 'balanced',
    docId: 'doc-1',
    candidateDocId: 'doc-1',
    docCharCount: 1000,
    instanceType: 'preview',
    isCurrentlyVisible: false,
    lastUsedAt: 1000,
    now: 2000,
    hasUncommittedDraft: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(2000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('decideResource', () => {
  it('未提交草稿时强制保留', () => {
    const result = decideResource(baseInput({ hasUncommittedDraft: true }))
    expect(result).toEqual({ action: 'keep' })
  })

  it('当前可见实例强制保留', () => {
    const result = decideResource(baseInput({ isCurrentlyVisible: true }))
    expect(result).toEqual({ action: 'keep' })
  })

  it('Diff 离开后释放', () => {
    const result = decideResource(baseInput({ instanceType: 'diff' }))
    expect(result).toEqual({ action: 'release' })
  })

  it('不同文档时释放', () => {
    const result = decideResource(baseInput({
      docId: 'doc-2',
      candidateDocId: 'doc-1',
    }))
    expect(result).toEqual({ action: 'release' })
  })

  describe('memory 策略', () => {
    it('非当前可见实例释放', () => {
      const result = decideResource(baseInput({ policy: 'memory' }))
      expect(result).toEqual({ action: 'release' })
    })
  })

  describe('balanced 策略', () => {
    it('小文档保留 45 秒（基于 lastUsedAt 固定截止）', () => {
      const result = decideResource(baseInput({
        policy: 'balanced',
        docCharCount: 5000,
        lastUsedAt: 1000,
        now: 2000,
      }))
      expect(result).toEqual({ action: 'keepUntil', deadline: 1000 + BALANCED_SMALL_DOC_TTL_MS })
    })

    it('99999 字符视为小文档', () => {
      const result = decideResource(baseInput({
        policy: 'balanced',
        docCharCount: 99999,
        lastUsedAt: 1000,
        now: 2000,
      }))
      expect(result).toEqual({ action: 'keepUntil', deadline: 1000 + BALANCED_SMALL_DOC_TTL_MS })
    })

    it('100000 字符视为长文档，保留 5 秒', () => {
      const result = decideResource(baseInput({
        policy: 'balanced',
        docCharCount: BALANCED_LARGE_DOC_THRESHOLD,
        lastUsedAt: 1000,
        now: 2000,
      }))
      expect(result).toEqual({ action: 'keepUntil', deadline: 1000 + BALANCED_LARGE_DOC_TTL_MS })
    })

    it('截止时间已过期时立即释放', () => {
      const result = decideResource(baseInput({
        policy: 'balanced',
        docCharCount: 5000,
        lastUsedAt: 1000,
        now: 1000 + BALANCED_SMALL_DOC_TTL_MS + 1,
      }))
      expect(result).toEqual({ action: 'release' })
    })

    it('重新决策不延后截止时间（固定基于 lastUsedAt）', () => {
      const result1 = decideResource(baseInput({
        policy: 'balanced',
        docCharCount: 5000,
        lastUsedAt: 1000,
        now: 2000,
      }))
      const result2 = decideResource(baseInput({
        policy: 'balanced',
        docCharCount: 5000,
        lastUsedAt: 1000,
        now: 40000,
      }))
      // 两次决策的 deadline 相同，不随 now 变化
      expect(result1).toEqual({ action: 'keepUntil', deadline: 1000 + BALANCED_SMALL_DOC_TTL_MS })
      expect(result2).toEqual({ action: 'keepUntil', deadline: 1000 + BALANCED_SMALL_DOC_TTL_MS })
    })
  })

  describe('speed 策略', () => {
    it('始终保留', () => {
      const result = decideResource(baseInput({ policy: 'speed' }))
      expect(result).toEqual({ action: 'keep' })
    })
  })
})

describe('getNextPrewarmTarget', () => {
  function basePrewarmInput(overrides: Partial<{
    activeMode: 'edit' | 'preview' | 'edit-preview'
    contentLength: number
    diffLineCount: number
    level: 'smart' | 'turbo'
    usage: Partial<Record<PrewarmTargetMode, { count: number; lastUsedAt: number }>>
  }> = {}) {
    return {
      activeMode: 'edit' as const,
      contentLength: 5000,
      diffLineCount: 0,
      level: 'smart' as const,
      resolveKey: (mode: PrewarmTargetMode) => `key-${mode}`,
      warmedKeys: new Set<string>(),
      usage: {},
      ...overrides,
    }
  }

  it('smart + 小文档返回 preview 预热目标', () => {
    const result = getNextPrewarmTarget(basePrewarmInput({
      contentLength: 50000,
      level: 'smart',
    }))
    expect(result).toBe('preview')
  })

  it('smart + 大文档（>= 10万）不返回 preview 预热目标', () => {
    const result = getNextPrewarmTarget(basePrewarmInput({
      contentLength: MODE_PREWARM_HUGE_DOC_LENGTH,
      level: 'smart',
    }))
    expect(result).toBeNull()
  })

  it('smart + 20万字符不返回 preview 预热目标', () => {
    const result = getNextPrewarmTarget(basePrewarmInput({
      contentLength: 200000,
      level: 'smart',
    }))
    expect(result).toBeNull()
  })

  it('turbo + 大文档仍返回 preview 预热目标', () => {
    const result = getNextPrewarmTarget(basePrewarmInput({
      contentLength: 200000,
      level: 'turbo',
    }))
    expect(result).toBe('preview')
  })

  it('turbo + 小文档返回 preview 预热目标', () => {
    const result = getNextPrewarmTarget(basePrewarmInput({
      contentLength: 50000,
      level: 'turbo',
    }))
    expect(result).toBe('preview')
  })

  it('smart + 小文档在 preview 已预热时返回下一候选', () => {
    const result = getNextPrewarmTarget(basePrewarmInput({
      contentLength: 50000,
      level: 'smart',
      warmedKeys: new Set(['key-preview']),
    }))
    // preview is warmed, fallback to next frequent mode
    expect(result).toBe('edit-preview')
  })

  it('smart + 小文档在所有候选已预热时返回 null', () => {
    const result = getNextPrewarmTarget(basePrewarmInput({
      contentLength: 50000,
      level: 'smart',
      warmedKeys: new Set(['key-preview', 'key-edit-preview', 'key-dual-preview', 'key-diff-preview']),
    }))
    expect(result).toBeNull()
  })

  it('smart + 小文档返回高频使用模式作为额外预热目标', () => {
    const result = getNextPrewarmTarget(basePrewarmInput({
      contentLength: 50000,
      level: 'smart',
      usage: { 'edit-preview': { count: 10, lastUsedAt: Date.now() } },
    }))
    // preview is first, edit-preview is second. Since preview is not warmed, it's returned first.
    expect(result).toBe('preview')
  })

  it('smart + 大文档跳过所有额外预热模式', () => {
    const result = getNextPrewarmTarget(basePrewarmInput({
      contentLength: 200000,
      level: 'smart',
      usage: { 'edit-preview': { count: 10, lastUsedAt: Date.now() } },
    }))
    expect(result).toBeNull()
  })
})
