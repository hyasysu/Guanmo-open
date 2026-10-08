import { useState } from 'react'
import { Button, Input } from 'animal-island-ui'
import { syncDesktopCredential } from '@/stores/settingsStore'
import type { ApiConnection } from '@/services/apiConnection'

export function DesktopApiKeyControl({ kind, configured, label }: {
  kind: ApiConnection['kind']
  configured?: boolean
  label: string
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (remove = false) => {
    setBusy(true)
    setError('')
    try {
      await syncDesktopCredential(kind, remove ? { remove: true } : { value: draft })
      setDraft('')
    } catch {
      setError('安全存储更新失败，请重试')
    } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-2">
      <Input type="password" aria-label={label} value={draft} onChange={(event) => setDraft(event.target.value)}
        placeholder={configured ? '已配置；留空保持不变，输入新 Key 后替换' : '未配置；输入 Key 后保存'} disabled={busy} />
      <div className="flex items-center gap-2">
        <Button type="default" size="small" disabled={!draft || busy} onClick={() => void save()}>{configured ? '替换 Key' : '保存 Key'}</Button>
        <Button type="default" size="small" className="text-gm-error" disabled={!configured || busy} onClick={() => void save(true)}>删除 Key</Button>
      </div>
      {error && <p role="alert" className="text-caption text-gm-error">{error}</p>}
    </div>
  )
}
