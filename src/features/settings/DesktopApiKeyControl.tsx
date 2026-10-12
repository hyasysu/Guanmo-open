import { useEffect, useRef, useState } from 'react'
import { Input } from 'animal-island-ui'
import { syncDesktopCredential } from '@/stores/settingsStore'
import type { ApiConnection } from '@/services/apiConnection'

export function DesktopApiKeyControl({ kind, configured, label }: {
  kind: ApiConnection['kind']
  configured?: boolean
  label: string
}) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const revision = useRef(0)
  const mounted = useRef(false)
  const pending = useRef(new Set<number>())
  const dirty = useRef(false)
  const focused = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(timer.current) }
  }, [])
  const save = async (value: string, version: number) => {
    clearTimeout(timer.current)
    timer.current = undefined
    if (pending.current.has(version)) return
    pending.current.add(version)
    setError('')
    try {
      const saved = await syncDesktopCredential(kind, value ? { value } : { remove: true })
      if (!saved) throw new Error('目标已变更')
      if (mounted.current && version === revision.current) {
        dirty.current = false
        if (!focused.current) { setDraft(''); setEditing(false) }
      }
    } catch {
      if (mounted.current && version === revision.current) setError('安全存储更新失败，请离开输入框重试')
    } finally { pending.current.delete(version) }
  }
  const edit = (value: string) => {
    dirty.current = true
    setDraft(value)
    setEditing(true)
    setError('')
    const version = ++revision.current
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(value, version), 500)
  }
  return (
    <div className="flex flex-col gap-2">
      <Input type="password" aria-label={label} value={editing ? draft : configured ? '••••••••' : ''}
        onFocus={() => { focused.current = true; setEditing(true) }}
        onChange={(event) => edit(event.target.value)}
        onKeyDown={(event) => {
          if (configured && !dirty.current && (event.key === 'Backspace' || event.key === 'Delete')) edit('')
        }}
        onBlur={() => {
          focused.current = false
          if (dirty.current) void save(draft, revision.current)
          else { setDraft(''); setEditing(false) }
        }}
        placeholder={configured ? '已配置；输入替换，退格清除，自动保存' : '输入 API Key，自动保存'} />
      {error && <p role="alert" className="text-caption text-gm-error">{error}</p>}
    </div>
  )
}
