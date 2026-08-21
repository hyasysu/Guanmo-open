/**
 * findNearestMatchIndex 契约测试
 *
 * 验证「搜索跳最近位置」的核心选择规则：
 * - 无锚点 / 空匹配 → 0（保持现状：跳文档首个匹配）。
 * - 锚点在前/中/后时选择距离最近者。
 * - 距离平局时取 from >= anchor 的后者（搜索方向优先）。
 */
import { describe, expect, it } from 'vitest'

import { findNearestMatchIndex } from '@/components/editor/SearchOverlay'

const matches = [
  { from: 10, to: 13 },
  { from: 40, to: 43 },
  { from: 80, to: 83 },
]

describe('findNearestMatchIndex（离锚点最近的匹配）', () => {
  it('无锚点或空匹配返回 0（现状兜底）', () => {
    expect(findNearestMatchIndex(matches, undefined)).toBe(0)
    expect(findNearestMatchIndex([], 50)).toBe(0)
  })

  it('锚点在各匹配之间时选距离最近者', () => {
    // 40 vs 10：距 35 分别为 5 / 25 → 选 40
    expect(findNearestMatchIndex(matches, 35)).toBe(1)
    // 10 vs 40：距 20 分别为 10 / 20 → 选 10
    expect(findNearestMatchIndex(matches, 20)).toBe(0)
    // 40 vs 80：距 65 分别为 25 / 15 → 选 80
    expect(findNearestMatchIndex(matches, 65)).toBe(2)
  })

  it('锚点在文档首匹配之前 → 选首个匹配', () => {
    expect(findNearestMatchIndex(matches, 5)).toBe(0)
  })

  it('锚点在文档末尾之后 → 选末尾匹配', () => {
    expect(findNearestMatchIndex(matches, 500)).toBe(2)
  })

  it('距离平局时取 from >= anchor 的后者（搜索方向优先）', () => {
    // 10 与 40 距 25 均为 15 → 取后者 40
    expect(findNearestMatchIndex(matches, 25)).toBe(1)
  })

  it('锚点恰好落在匹配起点 → 选中该匹配', () => {
    expect(findNearestMatchIndex(matches, 40)).toBe(1)
  })
})
