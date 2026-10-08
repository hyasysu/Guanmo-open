import { invoke } from '@tauri-apps/api/core'
import { getDatabase, isDatabaseReady } from './db'
import { isWebRuntime } from '@/services/runtimeCapabilities'
import { UnsupportedCapabilityError } from '@/services/externalHttp'

function requireDesktopOrganization(): void {
  if (isWebRuntime()) throw new UnsupportedCapabilityError('阅读成果收藏与分类')
}

export interface ArtifactCategory { id: string; name: string }
export interface ArtifactOrganization { artifactKey: string; favorite: boolean; categoryIds: string[] }
export interface ArtifactOrganizationSnapshot {
  categories: ArtifactCategory[]
  entries: ArtifactOrganization[]
}
export interface ArtifactOrganizationFilter {
  collection?: 'all' | 'favorites' | 'unclassified'
  categoryId?: string
}

export function decodeArtifactOrganization(row: Record<string, unknown>): ArtifactOrganization {
  const ids: unknown = JSON.parse(String(row.category_ids))
  if (typeof row.artifact_key !== 'string' || !/^(mark|ai):.+/.test(row.artifact_key)
    || (row.favorite !== 0 && row.favorite !== 1)
    || !Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('阅读成果整理信息无效')
  }
  return { artifactKey: row.artifact_key, favorite: row.favorite === 1, categoryIds: [...new Set(ids as string[])] }
}

export async function loadArtifactOrganization(): Promise<ArtifactOrganizationSnapshot> {
  if (!isDatabaseReady()) return { categories: [], entries: [] }
  requireDesktopOrganization()
  const db = getDatabase()
  const [rows, categories] = await Promise.all([
    db.select<Record<string, unknown>>('SELECT * FROM reading_artifact_organization'),
    db.select<ArtifactCategory>('SELECT id, name FROM reading_artifact_categories ORDER BY name, id'),
  ])
  if (categories.some((category) => typeof category.id !== 'string' || !category.id
    || typeof category.name !== 'string' || !category.name.trim())) throw new Error('阅读成果分类信息无效')
  return { categories, entries: rows.map(decodeArtifactOrganization) }
}

export async function setArtifactOrganization(artifactKey: string, patch: { favorite?: boolean; categoryIds?: string[] }): Promise<void> {
  requireDesktopOrganization()
  await invoke('set_reading_artifact_organization', { artifactKey, favorite: patch.favorite ?? null, categoryIds: patch.categoryIds ?? null })
}

export async function saveArtifactCategory(category: ArtifactCategory): Promise<void> {
  requireDesktopOrganization()
  await invoke('save_reading_artifact_category', { category })
}

export async function deleteArtifactCategory(id: string): Promise<void> {
  requireDesktopOrganization()
  await invoke('delete_reading_artifact_category', { id })
}

// Apply before counting/paging, including document summaries. Keys are bound or
// constructed from trusted table expressions; user category names never enter SQL.
export function artifactOrganizationClause(key: string, filter: ArtifactOrganizationFilter, params: unknown[]): string {
  const clauses: string[] = []
  if (filter.collection === 'favorites') clauses.push(`EXISTS (SELECT 1 FROM reading_artifact_organization o WHERE o.artifact_key = ${key} AND o.favorite = 1)`)
  if (filter.collection === 'unclassified') clauses.push(`NOT EXISTS (SELECT 1 FROM reading_artifact_organization o WHERE o.artifact_key = ${key} AND json_array_length(o.category_ids) > 0)`)
  if (filter.categoryId) {
    params.push(filter.categoryId)
    clauses.push(`EXISTS (SELECT 1 FROM reading_artifact_organization o, json_each(o.category_ids) c WHERE o.artifact_key = ${key} AND c.value = $${params.length})`)
  }
  return clauses.join(' AND ')
}
