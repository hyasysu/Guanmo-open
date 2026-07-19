export interface MemoryQueryFilters {
  category?: string
  categories?: readonly string[]
  statuses?: readonly string[]
  scopeType?: 'global' | 'project'
  scopeKey?: string | null
  includeEmbedding?: boolean
}

export interface SqlQuery {
  sql: string
  params: unknown[]
}

const MEMORY_COLUMNS = [
  'id', 'content', 'category', 'source', 'locked', 'status',
  'scope_type', 'scope_key', 'subject', 'fact_key', 'fact_value',
  'confidence', 'evidence', 'supersedes_id', 'embedding_model',
  'content_hash', 'created_at', 'updated_at',
]

export function buildMemoryQuery(filters: MemoryQueryFilters = {}): SqlQuery {
  const params: unknown[] = []
  const conditions: string[] = []
  const addValues = (column: string, values: readonly string[]) => {
    if (values.length === 0) {
      conditions.push('1 = 0')
      return
    }
    const placeholders = values.map((value) => {
      params.push(value)
      return `$${params.length}`
    })
    conditions.push(`${column} IN (${placeholders.join(', ')})`)
  }

  if (filters.category) {
    params.push(filters.category)
    conditions.push(`category = $${params.length}`)
  } else if (filters.categories) {
    addValues('category', filters.categories)
  }
  if (filters.statuses) addValues('status', filters.statuses)

  if (filters.scopeType === 'global') {
    conditions.push("COALESCE(scope_type, 'global') = 'global'")
  } else if (filters.scopeType === 'project') {
    params.push(filters.scopeKey || '')
    conditions.push(`(
      COALESCE(scope_type, 'global') = 'global'
      OR (scope_type = 'project' AND scope_key = $${params.length})
    )`)
  }

  const columns = filters.includeEmbedding
    ? [...MEMORY_COLUMNS, 'embedding']
    : MEMORY_COLUMNS
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  return {
    sql: `SELECT ${columns.join(', ')} FROM memories${where} ORDER BY updated_at DESC`,
    params,
  }
}

export function buildMemoryEmbeddingQuery(ids: readonly string[]): SqlQuery | null {
  if (ids.length === 0) return null
  return {
    sql: `SELECT id, embedding, embedding_model, content_hash FROM memories WHERE id IN (${ids.map((_, index) => `$${index + 1}`).join(', ')})`,
    params: [...ids],
  }
}
