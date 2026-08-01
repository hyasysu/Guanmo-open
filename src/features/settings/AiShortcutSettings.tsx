import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Input, Switch } from 'animal-island-ui'
import {
  AI_SHORTCUT_LABEL_MAX_LENGTH,
  AI_SHORTCUT_PROMPT_MAX_LENGTH,
  type AiShortcutAction,
} from '@/services/aiShortcutActions'
import { useSettingsStore } from '@/stores/settingsStore'
import { toast } from '@/services/toast'

interface ActionDraft {
  id: string | null
  label: string
  prompt: string
}

const DIALOG_FADE_DURATION = 160

function createActionId() {
  return `ai-shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function AiShortcutSettings() {
  const actions = useSettingsStore((state) => state.aiShortcutActions)
  const setActions = useSettingsStore((state) => state.setAiShortcutActions)
  const resetActions = useSettingsStore((state) => state.resetAiShortcutActions)
  const [draft, setDraft] = useState<ActionDraft | null>(null)
  const [errors, setErrors] = useState<{ label?: string; prompt?: string }>({})
  const [editorClosing, setEditorClosing] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  const editorOpen = draft !== null

  const closeEditor = useCallback(() => {
    if (!editorOpen || editorClosing) return
    setEditorClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      setDraft(null)
      setErrors({})
      setEditorClosing(false)
      closeTimerRef.current = null
    }, DIALOG_FADE_DURATION)
  }, [editorClosing, editorOpen])

  useEffect(() => {
    if (!editorOpen) return
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeEditor()
      }
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [closeEditor, editorOpen])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  const openCreate = () => {
    setErrors({})
    setEditorClosing(false)
    setDraft({ id: null, label: '', prompt: '' })
  }

  const openEdit = (action: AiShortcutAction) => {
    setErrors({})
    setEditorClosing(false)
    setDraft({ id: action.id, label: action.label, prompt: action.prompt })
  }

  const saveDraft = () => {
    if (!draft) return
    const label = draft.label.trim()
    const prompt = draft.prompt.trim()
    const nextErrors = {
      label: !label
        ? '请输入操作名称'
        : label.length > AI_SHORTCUT_LABEL_MAX_LENGTH
          ? `操作名称不能超过 ${AI_SHORTCUT_LABEL_MAX_LENGTH} 个字符`
          : undefined,
      prompt: !prompt
        ? '请输入 AI 命令'
        : prompt.length > AI_SHORTCUT_PROMPT_MAX_LENGTH
          ? `AI 命令不能超过 ${AI_SHORTCUT_PROMPT_MAX_LENGTH} 个字符`
          : undefined,
    }
    if (nextErrors.label || nextErrors.prompt) {
      setErrors(nextErrors)
      return
    }

    if (draft.id) {
      setActions(actions.map((action) => (
        action.id === draft.id ? { ...action, label, prompt } : action
      )))
      toast.success('快捷操作已更新')
    } else {
      setActions([
        ...actions,
        { id: createActionId(), label, prompt, enabled: true },
      ])
      toast.success('快捷操作已添加')
    }
    closeEditor()
  }

  const toggleAction = (id: string, enabled: boolean) => {
    setActions(actions.map((action) => action.id === id ? { ...action, enabled } : action))
  }

  const moveAction = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || toIndex >= actions.length) return
    const next = [...actions]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    setActions(next)
  }

  const deleteAction = (action: AiShortcutAction) => {
    if (!window.confirm(`确认删除快捷操作“${action.label}”吗？`)) return
    setActions(actions.filter((item) => item.id !== action.id))
    toast.success('快捷操作已删除')
  }

  const restoreDefaults = () => {
    if (!window.confirm('确认恢复默认快捷操作吗？当前自定义内容将被覆盖。')) return
    resetActions()
    toast.success('已恢复默认快捷操作')
  }

  return (
    <div className="w-full pb-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-micro font-bold uppercase tracking-wider text-gm-text-tertiary">选区 AI 快捷操作</h3>
          <p className="mt-1 text-caption text-gm-text-secondary">
            用于源码编辑器与 Markdown 预览区的选区右键菜单，命令会沿用当前 AI 路由和自动发送设置。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="default" size="small" onClick={restoreDefaults}>恢复默认</Button>
          <Button type="primary" size="small" onClick={openCreate}>新增操作</Button>
        </div>
      </div>

      <div className="space-y-2">
        {actions.length === 0 && (
          <div className="rounded-xl border border-dashed border-gm-border bg-gm-surface-elevated px-4 py-6 text-center text-caption text-gm-text-secondary">
            当前没有快捷操作，可新增操作或恢复默认列表。
          </div>
        )}
        {actions.map((action, index) => (
          <div
            key={action.id}
            data-ai-shortcut-row={action.id}
            className="flex items-center gap-2 rounded-xl border border-gm-border bg-gm-surface-elevated px-3 py-2"
          >
            <div className="flex shrink-0 flex-col" aria-label={`调整“${action.label}”顺序`}>
              <button
                type="button"
                aria-label={`上移“${action.label}”`}
                disabled={index === 0}
                className="flex h-5 w-6 items-center justify-center rounded text-caption leading-none text-gm-text-tertiary transition-colors hover:bg-gm-surface-hover hover:text-gm-text disabled:cursor-not-allowed disabled:opacity-30"
                onClick={() => moveAction(index, index - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`下移“${action.label}”`}
                disabled={index === actions.length - 1}
                className="flex h-5 w-6 items-center justify-center rounded text-caption leading-none text-gm-text-tertiary transition-colors hover:bg-gm-surface-hover hover:text-gm-text disabled:cursor-not-allowed disabled:opacity-30"
                onClick={() => moveAction(index, index + 1)}
              >
                ↓
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-body font-medium text-gm-text">{action.label}</div>
              <div className="mt-0.5 truncate text-caption text-gm-text-tertiary">{action.prompt}</div>
            </div>
            <Switch
              checked={action.enabled}
              onChange={(enabled) => toggleAction(action.id, enabled)}
            />
            <Button type="default" size="small" onClick={() => openEdit(action)}>编辑</Button>
            <Button type="default" size="small" danger onClick={() => deleteAction(action)}>删除</Button>
          </div>
        ))}
      </div>

      {draft && createPortal(
        <div
          className={`gm-settings-mask gm-ai-shortcut-dialog-mask fixed inset-0 z-[1100] flex items-center justify-center p-4 ${
            editorClosing ? 'is-closing pointer-events-none' : ''
          }`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor()
          }}
        >
          <div className={`gm-settings-modal gm-ai-shortcut-dialog-panel w-full max-w-[560px] ${
            editorClosing ? 'is-closing' : ''
          }`}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="ai-shortcut-dialog-title"
              className="max-h-[calc(100vh-32px)] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-gm-border-subtle pb-3">
                <h2 id="ai-shortcut-dialog-title" className="text-heading font-bold text-gm-text">
                  {draft.id ? '编辑快捷操作' : '新增快捷操作'}
                </h2>
                <button
                  type="button"
                  aria-label="关闭快捷操作编辑弹窗"
                  className="rounded-lg px-2 py-1 text-body text-gm-text-secondary hover:bg-gm-surface-hover hover:text-gm-text"
                  onClick={closeEditor}
                >
                  ×
                </button>
              </div>
              <div className="space-y-4 py-4">
                <label className="block">
                  <span className="mb-1.5 block text-caption font-medium text-gm-text">操作名称</span>
                  <Input
                    value={draft.label}
                    maxLength={AI_SHORTCUT_LABEL_MAX_LENGTH}
                    status={errors.label ? 'error' : undefined}
                    placeholder="例如：提炼关键结论"
                    onChange={(event) => {
                      setDraft({ ...draft, label: event.target.value })
                      if (errors.label) setErrors({ ...errors, label: undefined })
                    }}
                  />
                  <span className={`mt-1 block text-micro ${errors.label ? 'text-gm-error' : 'text-gm-text-tertiary'}`}>
                    {errors.label || `${draft.label.length}/${AI_SHORTCUT_LABEL_MAX_LENGTH}`}
                  </span>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-caption font-medium text-gm-text">AI 命令</span>
                  <textarea
                    value={draft.prompt}
                    maxLength={AI_SHORTCUT_PROMPT_MAX_LENGTH}
                    placeholder="描述 AI 应如何处理当前选区"
                    className={`min-h-36 w-full resize-y rounded-xl border bg-gm-surface px-3 py-2 text-body text-gm-text outline-none transition-colors placeholder:text-gm-text-tertiary ${
                      errors.prompt ? 'border-gm-error' : 'border-gm-border focus:border-gm-primary'
                    }`}
                    onChange={(event) => {
                      setDraft({ ...draft, prompt: event.target.value })
                      if (errors.prompt) setErrors({ ...errors, prompt: undefined })
                    }}
                  />
                  <span className={`mt-1 block text-micro ${errors.prompt ? 'text-gm-error' : 'text-gm-text-tertiary'}`}>
                    {errors.prompt || `${draft.prompt.length}/${AI_SHORTCUT_PROMPT_MAX_LENGTH}`}
                  </span>
                </label>
              </div>
              <div className="flex justify-end gap-2 border-t border-gm-border-subtle pt-3">
                <Button type="default" size="small" onClick={closeEditor}>取消</Button>
                <Button type="default" size="small" onClick={saveDraft}>保存</Button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
