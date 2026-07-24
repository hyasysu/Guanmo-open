import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadSettingsStore(persisted?: unknown, raw?: string) {
  vi.resetModules()
  localStorage.clear()
  if (raw !== undefined) {
    localStorage.setItem('guanmo-settings', raw)
  } else if (persisted !== undefined) {
    localStorage.setItem('guanmo-settings', JSON.stringify({ state: persisted, version: 0 }))
  }
  return (await import('@/stores/settingsStore')).useSettingsStore
}

describe('设置兼容', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('没有持久配置时使用完整默认值', async () => {
    const store = await loadSettingsStore()
    const state = store.getState()

    expect(state.editor).toMatchObject({
      fontSize: 14,
      lineHeight: 1.65,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
      previewFontFamily: 'var(--gm-font-family)',
      autoSave: true,
      modePerformancePolicy: 'balanced',
      inlinePreviewEdit: true,
    })
    expect(state.appearance).toMatchObject({ theme: 'light', lightPalette: 'warm' })
    expect(state.webSearch).toMatchObject({ provider: 'duckduckgo', maxResults: 5 })
  })

  it('旧配置缺少字段时由当前默认值补齐', async () => {
    const store = await loadSettingsStore({
      editor: { fontSize: 18 },
      appearance: { theme: 'dark' },
    })
    const state = store.getState()

    expect(state.editor).toMatchObject({
      fontSize: 18,
      lineHeight: 1.65,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
      previewFontFamily: 'var(--gm-font-family)',
      fullscreenContentPadding: 88,
      inlinePreviewEdit: true,
    })
    expect(state.appearance).toMatchObject({ theme: 'dark', lightPalette: 'warm', aiMascotAvatarEnabled: false })
  })

  it('新的明亮配色会从持久配置中恢复', async () => {
    const store = await loadSettingsStore({
      appearance: { lightPalette: 'github-dmmono' },
    })
    const state = store.getState()

    expect(state.appearance).toMatchObject({ theme: 'light', lightPalette: 'github-dmmono' })
  })

  it('未知字段不影响已知配置和默认值加载', async () => {
    const store = await loadSettingsStore({
      unknownRoot: { anonymous: true },
      editor: { fontSize: 16, unknownEditor: 'ignored' },
    })
    const state = store.getState()

    expect(state.editor.fontSize).toBe(16)
    expect(state.editor.autoSave).toBe(true)
    expect(state.ai).toBeDefined()
  })

  it('旧配置缺少 modePerformancePolicy 时默认 balanced', async () => {
    const store = await loadSettingsStore({
      editor: { fontSize: 16 },
    })
    const state = store.getState()
    expect(state.editor.modePerformancePolicy).toBe('balanced')
  })

  it('损坏的持久配置不会阻止应用使用默认设置', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const store = await loadSettingsStore(undefined, '{not-valid-json')

    expect(store.getState().editor.fontSize).toBe(14)
    expect(store.getState().appearance.theme).toBe('light')
  })
})

describe('旧字段迁移', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('新字段合法时以新字段为准', async () => {
    const store = await loadSettingsStore({
      editor: { modePerformancePolicy: 'speed', modePrewarm: 'off', modeResourcePolicy: 'memory' },
    })
    expect(store.getState().editor.modePerformancePolicy).toBe('speed')
  })

  it('新字段非法时回退迁移', async () => {
    const store = await loadSettingsStore({
      editor: { modePerformancePolicy: 'invalid', modePrewarm: 'smart' },
    } as unknown as Record<string, unknown>)
    expect(store.getState().editor.modePerformancePolicy).toBe('balanced')
  })

  it('只有旧 modePrewarm=off 时迁移为 memory', async () => {
    const store = await loadSettingsStore({
      editor: { modePrewarm: 'off' },
    } as unknown as Record<string, unknown>)
    expect(store.getState().editor.modePerformancePolicy).toBe('memory')
  })

  it('只有旧 modePrewarm=smart 时迁移为 balanced', async () => {
    const store = await loadSettingsStore({
      editor: { modePrewarm: 'smart' },
    } as unknown as Record<string, unknown>)
    expect(store.getState().editor.modePerformancePolicy).toBe('balanced')
  })

  it('只有旧 modePrewarm=turbo 时迁移为 speed', async () => {
    const store = await loadSettingsStore({
      editor: { modePrewarm: 'turbo' },
    } as unknown as Record<string, unknown>)
    expect(store.getState().editor.modePerformancePolicy).toBe('speed')
  })

  it('只有旧 modeResourcePolicy=memory 时迁移为 memory', async () => {
    const store = await loadSettingsStore({
      editor: { modeResourcePolicy: 'memory' },
    } as unknown as Record<string, unknown>)
    expect(store.getState().editor.modePerformancePolicy).toBe('memory')
  })

  it('只有旧 modeResourcePolicy=balanced 时迁移为 balanced', async () => {
    const store = await loadSettingsStore({
      editor: { modeResourcePolicy: 'balanced' },
    } as unknown as Record<string, unknown>)
    expect(store.getState().editor.modePerformancePolicy).toBe('balanced')
  })

  it('只有旧 modeResourcePolicy=speed 时迁移为 speed', async () => {
    const store = await loadSettingsStore({
      editor: { modeResourcePolicy: 'speed' },
    } as unknown as Record<string, unknown>)
    expect(store.getState().editor.modePerformancePolicy).toBe('speed')
  })

  describe('两个旧字段组合时选择较保守的较低档', () => {
    const prewarmValues = ['off', 'smart', 'turbo'] as const
    const resourceValues = ['memory', 'balanced', 'speed'] as const
    const expected: Record<string, Record<string, string>> = {
      off: { memory: 'memory', balanced: 'memory', speed: 'memory' },
      smart: { memory: 'memory', balanced: 'balanced', speed: 'balanced' },
      turbo: { memory: 'memory', balanced: 'balanced', speed: 'speed' },
    }
    for (const pw of prewarmValues) {
      for (const rp of resourceValues) {
        it(`modePrewarm=${pw} + modeResourcePolicy=${rp} → ${expected[pw][rp]}`, async () => {
          const store = await loadSettingsStore({
            editor: { modePrewarm: pw, modeResourcePolicy: rp },
          } as unknown as Record<string, unknown>)
          expect(store.getState().editor.modePerformancePolicy).toBe(expected[pw][rp])
        })
      }
    }
  })

  it('两个旧字段都非法时使用 balanced', async () => {
    const store = await loadSettingsStore({
      editor: { modePrewarm: 'bad', modeResourcePolicy: 'bad' },
    } as unknown as Record<string, unknown>)
    expect(store.getState().editor.modePerformancePolicy).toBe('balanced')
  })

  it('两个旧字段都缺失时使用 balanced', async () => {
    const store = await loadSettingsStore({
      editor: { fontSize: 16 },
    })
    expect(store.getState().editor.modePerformancePolicy).toBe('balanced')
  })

  it('迁移后运行时对象不含旧字段', async () => {
    localStorage.clear()
    const store = await loadSettingsStore({
      editor: { modePrewarm: 'off', modeResourcePolicy: 'memory' },
    } as unknown as Record<string, unknown>)
    const state = store.getState()
    expect(state.editor).toHaveProperty('modePerformancePolicy')
    expect(state.editor as Record<string, unknown>).not.toHaveProperty('modePrewarm')
    expect(state.editor as Record<string, unknown>).not.toHaveProperty('modeResourcePolicy')
  })

  it('迁移后重新写入的 localStorage 不含旧字段', async () => {
    localStorage.clear()
    const store = await loadSettingsStore({
      editor: { modePrewarm: 'turbo', modeResourcePolicy: 'speed' },
    } as unknown as Record<string, unknown>)
    // Trigger a state change to force persistence
    store.getState().updateEditorSettings({ fontSize: 16 })
    // Wait for persist middleware debounce
    await new Promise(r => setTimeout(r, 50))
    const raw = localStorage.getItem('guanmo-settings')
    expect(raw).toBeTruthy()
    // After migration, saved data should not contain old fields
    expect(raw).not.toContain('"modePrewarm"')
    expect(raw).not.toContain('"modeResourcePolicy"')
    expect(raw).toContain('"modePerformancePolicy"')
  })
})
