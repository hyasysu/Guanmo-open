import { fileExists } from '@/hooks/useTauri'
import { normalizeFilePath } from '@/services/pathIdentity'
import { listEmbeddingJobs, loadAllDocuments, loadDocumentFilePaths, removeEmbeddingJobByPath, removePersistedDocumentByPath } from '@/services/database/persistence'
import { indexWorkspaceMarkdown, type WorkspaceIndexResult } from '@/services/rag/indexer'
import { vectorStore } from '@/services/rag/vectorStore'

export interface WorkspaceCleanupResult {
  removed: number
  removedPaths: string[]
}

export interface WorkspaceRebuildResult extends WorkspaceIndexResult {
  removed: number
  removedPaths: string[]
}

function isInsideWorkspace(filePath: string, workspacePath: string) {
  const file = normalizeFilePath(filePath)
  const workspace = normalizeFilePath(workspacePath)
  return file === workspace || file.startsWith(`${workspace}/`)
}

export async function cleanupMissingWorkspaceDocuments(workspacePath: string): Promise<WorkspaceCleanupResult> {
  const filePaths = await loadDocumentFilePaths()
  const jobPaths = (await listEmbeddingJobs()).map((job) => job.filePath)
  const paths = Array.from(new Set([...filePaths, ...jobPaths]))
  const removedPaths: string[] = []

  for (const filePath of paths) {
    if (!isInsideWorkspace(filePath, workspacePath)) continue
    const exists = await fileExists(filePath).catch(() => false)
    if (exists) continue
    vectorStore.removeByFilePath(filePath)
    await removePersistedDocumentByPath(filePath)
    await removeEmbeddingJobByPath(filePath)
    removedPaths.push(filePath)
  }

  return {
    removed: removedPaths.length,
    removedPaths,
  }
}

export async function rebuildWorkspaceDocuments(workspacePath: string): Promise<WorkspaceRebuildResult> {
  const documents = await loadAllDocuments()
  const removedPaths: string[] = []

  for (const doc of documents) {
    if (!isInsideWorkspace(doc.filePath, workspacePath)) continue
    vectorStore.removeByFilePath(doc.filePath)
    await removePersistedDocumentByPath(doc.filePath)
    await removeEmbeddingJobByPath(doc.filePath)
    removedPaths.push(doc.filePath)
  }

  const result = await indexWorkspaceMarkdown(workspacePath)
  return {
    ...result,
    removed: removedPaths.length,
    removedPaths,
  }
}
