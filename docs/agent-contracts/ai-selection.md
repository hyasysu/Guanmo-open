# AI 与选区契约

涉及 `src/services/rag/semanticChunker.ts`、`read_selection_context`、AI 路由、检索、长期记忆触发或 Agent 事件时，修改前必须读取本文件。

## 选区语义上下文

- RAG 索引与 `read_selection_context` 共用 `src/services/rag/semanticChunker.ts` 的 AST 语义原子。
- `read_selection_context` 只接受本轮 selection 授权，只返回包含 `role`、`headingPath`、`content` 的 `chunks` 数组。
- `direction=auto` 按相关性读取；`before/after/both` 是方向硬约束，按文档顺序读取，不得让另一方向参与预算竞争。
- Markdown 标题选区必须锚定该标题正文；`direction=after` 的范围包含其子标题，并在下一个同级或更高级标题前停止。
- Level 1 总预算为 700 tokens；仅在信息不足时调用 Level 2，将累计预算扩展到 1400 tokens，且只返回新增语义原子。
- 同一轮禁止跳级、重复读取同一层或自动升级为全文读取。

## AI 回答与检索触发

- 普通问答和简单解释按问题复杂度直接回答，不强制分段；总结、研究、Web 对照或复杂多步骤问题才使用结构化输出。
- 助手消息只有实际使用本地或 Web 资料时才展示来源；普通无来源回答不展示来源占位。
- 明确的主题研究、调研或归纳可直接检索全库 `search_knowledge`，无需 tag；指定文件总结仍需 file tag，任何文档改写仍需本轮 selection/file tag 和确认卡片。
- 只有要求沿用用户既有风格、语气、格式或习惯的改写才轻量检索 `preference/instruction` 长期记忆；普通改写不检索记忆。
- 手动保存沿用 1.2 秒 RAG 索引延迟，自动保存使用 5 秒索引防抖；同一文件的重复任务必须继续合并。
- Agent 执行入口使用单一 `AgentRunRequest` 对象；外部工具事件必须先经 `agent/session.ts` 运行时解码，再写入聊天 store。
