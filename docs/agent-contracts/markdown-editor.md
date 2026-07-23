# Markdown 编辑与预览契约

涉及 Markdown 渲染、大文档、预览内源码编辑、块定位、滚动同步或预览 Worker 时，修改前必须读取本文件。

- 所有文档统一使用同步 `ReactMarkdown` 渲染；不得按内容长度切换 Worker、分块虚拟化或“正在解析预览”占位路径。
- 预览顶层块统一由 `src/services/markdownBlocks.ts` 基于原始 Markdown offset 描述；预览内源码编辑必须按原始切片精确替换并在切片失效时保留草稿、提示冲突，不得使用 LaTeX 规范化后的 offset。
- “预览内源码编辑”设置默认开启；Alt+点击由预览容器事件委托处理，块编辑器只维护局部 draft，退出时才写回完整文档。
- 大文档编辑继续使用 `EditorArea` 的预览更新防抖，目录跳转、任务列表行号和滚动同步沿用现有 DOM 行号标记。
- 桌面构建不得产出 `markdownPreview.worker-*` 独立脚本，回归检查由 `npm run build:desktop` 执行。
