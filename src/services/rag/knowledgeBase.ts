/**
 * 知识库服务边界 — UI 无关。
 * 提供手动入库、轻量状态查询和批量移除能力，
 * 供标签菜单和管理弹窗直接调用。
 */

import { normalizeFilePath } from '@/services/pathIdentity'
import { indexMarkdownDocumentAsync, cancelPendingIndexTimers, isMarkdownPath } from './indexer'
import { getKnowledgeDocumentStates, runSerializedDocumentOperation } from './pipeline'
import { loadDocumentIndexMetadata, removePersistedDocumentByPathTransaction } from '@/services/database/persistence'
import { vectorStore } from './vectorStore'
import { removeNativeRagIndexDocument } from './nativeIndex'
import { getEmbeddingConfig } from '@/services/ai/aiClient'
import { EMBEDDING_PREPROCESS_VERSION } from './embeddingInput'

export interface KnowledgeDocumentItem {
  filePath: string
  title: string
  state: string
  totalChunks: number
  embeddedChunks: number
}

export interface RemoveKnowledgeResult {
  success: string[]
  failed: Array<{ filePath: string; error: string }>
}

export interface AddKnowledgeResult {
  filePath: string
  success: boolean
  error?: string
}

/**
 * 获取知识库文档列表（轻量，不加载正文或向量）。
 */
export async function listKnowledgeDocuments(): Promise<KnowledgeDocumentItem[]> {
  return getKnowledgeDocumentStates()
}

/**
 * 轻量判断单文档是否已入库。
 * 不加载正文或 Embedding JSON。
 */
export async function isKnowledgeDocumentIndexed(filePath: string): Promise<boolean> {
  const embeddingModel = getEmbeddingConfig()?.embeddingModel || null
  const metadata = await loadDocumentIndexMetadata(
    filePath,
    embeddingModel,
    EMBEDDING_PREPROCESS_VERSION,
  )
  return metadata != null
}

/**
 * 手动将 Markdown 文档加入知识库，等待索引链路完整完成。
 * 非 Markdown 或空路径直接拒绝。
 */
export async function addKnowledgeDocument(params: {
  filePath: string
  title: string
  content: string
}): Promise<AddKnowledgeResult> {
  const { filePath, title, content } = params
  if (!filePath || !isMarkdownPath(filePath)) {
    return { filePath: filePath || '', success: false, error: '非 Markdown 文件或路径为空' }
  }
  try {
    const ok = await indexMarkdownDocumentAsync(filePath, title, content)
    return { filePath, success: ok }
  } catch (err) {
    return {
      filePath,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * 批量移除知识库文档。
 * 1. 去重并规范化路径。
 * 2. 取消目标路径待执行 timer。
 * 3. 每个路径进入 runSerializedDocumentOperation 串行。
 * 4. 执行 Rust 删除事务。
 * 5. 清理 vectorStore 内存。
 * 6. 调用 removeNativeRagIndexDocument。
 * 7. 汇总逐文件成功/失败结果。
 *
 * 单个文件失败不中断其他文件。
 */
export async function removeKnowledgeDocuments(
  filePaths: string[]
): Promise<RemoveKnowledgeResult> {
  const unique = [...new Set(filePaths.map((p) => normalizeFilePath(p)))]
  const normalizedOriginal = new Map(
    filePaths.map((p) => [normalizeFilePath(p), p])
  )

  cancelPendingIndexTimers(unique)

  const success: string[] = []
  const failed: Array<{ filePath: string; error: string }> = []

  for (const normalizedPath of unique) {
    const originalPath = normalizedOriginal.get(normalizedPath) || normalizedPath
    try {
      await runSerializedDocumentOperation(originalPath, async () => {
        const result = await removePersistedDocumentByPathTransaction(originalPath)
        if (!result.deleted) {
          throw new Error('文档未找到，可能已被移除')
        }
        vectorStore.removeByFilePathFromMemory(originalPath)
        await removeNativeRagIndexDocument(originalPath)
      })
      success.push(originalPath)
    } catch (err) {
      failed.push({
        filePath: originalPath,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { success, failed }
}