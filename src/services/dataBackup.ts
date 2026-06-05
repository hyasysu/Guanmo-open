import { openFileDialog, readFile, saveFileDialog, writeFile } from '@/hooks/useTauri'
import { exportBackupPayload, importBackupPayload, type BackupPayload } from '@/services/database/persistence'

function buildDefaultBackupName() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `guanmo-backup-${stamp}.json`
}

export async function exportDataBackup(): Promise<string> {
  const payload = await exportBackupPayload()
  const path = await saveFileDialog(buildDefaultBackupName(), [
    { name: 'JSON', extensions: ['json'] },
  ])
  if (!path) {
    throw new Error('已取消导出')
  }
  await writeFile(path, JSON.stringify(payload, null, 2))
  return path
}

export async function importDataBackup(): Promise<{ path: string; sessions: number; messages: number; memories: number }> {
  const result = await openFileDialog([{ name: 'JSON', extensions: ['json'] }])
  const path = Array.isArray(result) ? result[0] : result
  if (!path) {
    throw new Error('已取消导入')
  }

  const content = await readFile(path)
  const payload = JSON.parse(content) as BackupPayload
  const summary = await importBackupPayload(payload)
  return { path, ...summary }
}
