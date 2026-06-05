export type ContextTagType = 'file' | 'selection' | 'folder' | 'memory' | 'web'

export interface ContextTag {
  /** 唯一标识 */
  id: string
  /** 标签类型 */
  type: ContextTagType
  /** 显示名称（文件名 / "选中文本" / 文件夹名） */
  title: string
  /** 文件路径，selection/folder 类型可为 null */
  filePath: string | null
  /** folder 类型的目录路径 */
  folderPath?: string
  /** selection 类型存储截断后的选中文本；file/folder 类型为 null（发送时再读取） */
  content: string | null
  /** 截断预览，用于 hover tooltip */
  preview: string
  /** 选区起始行号 */
  startLine?: number
  /** 选区结束行号 */
  endLine?: number
  /** selection 类型在文档中的精确起始字符偏移 */
  selectionFrom?: number
  /** selection 类型在文档中的精确结束字符偏移 */
  selectionTo?: number
}

/** selection 类型内容截断上限 */
export const MAX_SELECTION_CHARS = 4000
/** 最大 tag 数量 */
export const MAX_CONTEXT_TAGS = 20
