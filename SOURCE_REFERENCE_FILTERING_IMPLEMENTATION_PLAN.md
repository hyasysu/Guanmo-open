# 来源引用筛选分阶段实施计划

> 本文件是“RAG/Agent 来源展示简化”任务的唯一状态来源。执行者必须使用 `staged-task-handoff` Skill，完整读取后每次只执行当前阶段，不得同时推进 `AI_IMPLEMENTATION_PLAN.md` 或其他计划。

## 当前状态

- 项目状态：已完成
- 当前阶段：阶段 4｜兼容持久化、展示与最终验收
- 阶段状态：已完成
- 上次执行结果：完成安全 URL 边界与最终隔离桌面验收；合法引用、完整候选、旧消息、无来源、长标题、混合来源、本地行号跳转和重启恢复均满足契约
- 验证结果：阶段 4 定向 Vitest 6 个文件共 78 项通过；`npm run test:runtime-schemas`、`npm run typecheck`、`npm run lint`（40 个既有 warning、0 error）、`npm run build:desktop`、`npm run check:bundle:desktop`、`git diff --check` 通过；隔离 Tauri 验收通过
- 本阶段剩余：无
- 本阶段允许修改：阶段 4 计划中列出的 ChatMessage 可选字段、metadata 编解码、来源展示、导出/阅读产物边界及直接测试范围
- 阻塞问题：无
- 下一阶段：无（阶段 4 为本任务最后阶段）
- Git 状态提醒：工作区已有大量用户修改，且 `useAiChat.ts`、Agent、Prompt、上下文预算文件与本任务重叠；不得覆盖、回退、格式化或夹带这些改动

## 项目目标

简化 AI 回答下方的来源展示：只把回答实际引用的本轮真实来源展示为“引用来源”，同时保留完整候选来源用于追溯和安全降级。Direct RAG 与 Agent 共用稳定、可校验的本轮引用 ID，不再让模型维护随数组位置变化的来源序号，也不再从回答尾部截取隐藏 JSON 数组。

## 与现有计划的关系

- 本任务细化 `AI_IMPLEMENTATION_PLAN.md` 的阶段 14（SOURCE-01），但不修改其状态、不推进其阶段历史。
- 新窗口只以本文件为执行状态源；不得在两个计划之间同步写入，除非用户后续明确要求。
- 本任务完成后，由用户决定是否把结果回填到主计划阶段 14。

## 已确认的问题

1. Direct RAG 上下文保留原始来源编号；预算跳过中间结果后，展示数组会压缩，按 `sources[index - 1]` 筛选会错选或漏选。
2. Agent 的 `search_knowledge` 返回普通 JSON，没有与展示数组一致的 `[知识来源 N]`；多次工具调用以及本地、选区、文件、Web 来源混合后更不存在稳定位置映射。
3. Agent 只有最终综合分支解析当前标记，常见的工具后直接回答分支不会解析，标记可能泄漏且来源保持全量。
4. 当前多行正则可在标记后仍有正文时匹配，再从标记起截断全文，存在删除回答尾部的路径。
5. 当前实现直接覆盖 `message.sources`，把“完整候选来源”和“用于展示的引用来源”混为一体，不利于旧聊天、导出和阅读产物继续保留可追溯信息。

## 技术方案

### 来源数据边界

- `sources` 继续保存本轮实际注入或真实工具返回的完整、去重候选来源，不因展示筛选而删除。
- 为每条候选来源分配仅在本轮回答内有效的稳定引用 ID，例如 `S1`、`S2`；同一来源重复出现时必须复用 ID。
- 本地来源的确定性身份使用规范化路径与精确行号范围；Web 来源使用规范化 URL。若工具已有不可变 `chunkId`，可作为内部去重证据，但不得要求旧聊天补齐。
- 新增的引用字段必须可选；旧聊天只含 `sources` 时继续按旧行为读取，不迁移、不清库、不重写历史正文。

### 模型协议

- 只给实际进入模型上下文的候选来源分配可见引用标签；Direct 与 Agent 共用同一注册表和校验器。
- 模型在正文事实附近使用 `[S1]` 形式引用；应用只从完整回答正文中提取合法引用，不删除、改写或隐藏正文片段。
- 只接受当前注册表中存在的 ID；未知、重复、格式错误或来自历史轮次的 ID 必须忽略。
- 不再使用 `[有效来源]` 加位置数组的尾部协议，不依赖模型输出隐藏 JSON。

### 展示与降级

- 存在至少一个合法正文引用时，界面“引用来源”只展示对应来源，按正文首次引用顺序去重。
- 没有合法引用时，不把候选来源伪装成“已采用”；保留现有折叠入口并标记为“检索来源/未确认引用”，供用户追溯。
- 来源打开仍复用现有本地授权与行号定位、Web 安全打开链路；不得扩大文件权限或新增浏览器直连能力。
- 保存聊天时保留完整 `sources` 和可选的已引用 ID；旧 metadata 缺字段时安全回退。

## 总体约束

- 每个新窗口默认只完成一个阶段；阶段完成并更新本文件后停止，不提前实施下一阶段。
- 修改前重新读取 `AGENTS.md`、本文件和当前阶段涉及的实际代码；代码与本文件冲突时以当前代码为准并最小修正文档。
- 保留工作区所有现有修改，尤其不得回退当前上下文预算、设置页、Agent deadline 或测试改动。
- 不新增依赖，不调整 RAG 检索权重、阈值、TopK、排序、Embedding、索引或数据库 schema。
- 不使用第二次模型调用判断来源，不增加后台服务，不要求模型输出不可见的自由文本 JSON。
- 不修改旧聊天正文；不清空、迁移或重建 SQLite、RAG 索引、配置或用户数据。
- 测试只使用匿名 Fixture、临时状态和 mock，不读取真实用户文档、数据库、API Key 或模型服务。
- 未经明确授权，不提交、推送、打 tag、创建 Release 或 PR。

## 风险与验收层级

- 风险：HIGH。涉及 RAG、Agent、聊天 metadata、来源展示和持久化兼容。
- Machine Gate 结果必须来自实际命令；代码阅读不能记为通过。
- 独立模型 Reviewer 仅在用户明确调用 `ai-code-review` Skill 后执行；最终交接建议 L3 验收。
- 真实 Tauri 验收只在最终阶段执行，自动测试不能替代来源跳转、历史恢复和视觉语义判断。

## 阶段计划

### 阶段 1｜稳定引用契约与回归基线

- 目标：建立纯函数来源注册表与引用解析/校验器，用测试复现当前错位和正文截断问题，不接入生产调用链。
- 允许范围：`src/services/ai/sourceReferences.ts`、确有必要时最小扩展 `src/services/ai/types.ts`、`tests/agent/sourceReferences.test.ts`、本文件。
- 验收标准：
  - 非连续原始 RAG 编号不会影响本轮连续引用 ID。
  - 本地/Web 来源按确定性身份去重，同源复用 ID，不同工具调用不发生位置碰撞。
  - 正文引用按首次出现顺序解析；重复与未知 ID被忽略。
  - 引用解析绝不删除或重写回答正文，尾部附加文本保持完整。
  - 空引用、无引用、格式异常均有明确安全结果。
- 检查命令：来源专项测试、RAG 上下文测试、`npm run typecheck`、定向 ESLint、`git diff --check`。
- 暂不处理：Direct/Agent 接线、Prompt、UI、聊天 metadata、导出和真实桌面验收。

### 阶段 2｜Direct RAG 稳定引用接入

- 目标：把 Direct RAG 实际装入上下文的来源注册为本轮引用，并移除位置数组筛选协议。
- 允许范围：RAG 上下文格式化的最小接口、`aiChatFlow`、`aiChatMessages`、系统回答规则、Direct 聊天编排及直接测试、本文件。
- 验收标准：
  - 预算跳过来源 1/2 或保留非连续原始结果时，`S1...Sn` 仍与实际注入来源一一对应。
  - 流式和非流式回答都不展示隐藏控制标记，也不因引用解析截断正文。
  - 只记录注册表内合法引用；无合法引用时保留候选来源并进入未确认降级。
  - 不改变检索结果、预算、排序、上下文安全边界和取消行为。
- 检查命令：`tests/agent/sourceReferences.test.ts`、`tests/agent/aiChatFlowContext.test.ts`、`tests/agent/aiChatMessages.test.ts`、`tests/rag/ragContext.test.ts`、`npm run typecheck`、定向 ESLint、`git diff --check`。
- 暂不处理：Agent 工具链、UI 文案、历史持久化。

### 阶段 3｜Agent 多工具来源接入

- 目标：让 Agent 的知识检索、选区读取、文件读取和 Web 搜索在同一本轮注册表中产生稳定引用，并覆盖所有最终回答出口。
- 允许范围：Agent 工具结果面向模型的来源标记、executor/result/source metadata、请求编排与直接测试、本文件。
- 验收标准：
  - 单次和多次 `search_knowledge`、混合本地/Web/选区/文件读取均不会重复或错映 ID。
  - 工具后直接回答、最终综合、达到工具/步骤上限、deadline 降级都使用同一引用校验路径。
  - 截断后的工具结果只能注册模型实际看到的来源；未注入模型的候选不能显示为已引用。
  - 未知 ID、历史 ID 和模型伪造 ID 不进入已引用列表。
  - 修改确认、权限、取消、工具预算和来源打开边界不变。
- 检查命令：来源专项测试、Agent execution/context continuation/orchestration 定向测试、`npm run test:selection-context`、`npm run typecheck`、定向 ESLint、`git diff --check`。
- 暂不处理：来源 UI 层级、聊天恢复、导出。

### 阶段 4｜兼容持久化、展示与最终验收

- 目标：保留完整候选来源和可选已引用 ID，聊天界面只突出合法引用来源，并兼容旧聊天与无引用降级。
- 允许范围：`ChatMessage` 可选字段、chat store metadata 编解码、`AiPanel` 来源展示、必要的导出/阅读产物调用边界、直接测试、本文件。
- 验收标准：
  - 新消息保存和重启恢复后，完整候选来源、已引用 ID 及展示结果一致。
  - 旧消息没有引用字段时仍可读取并以“检索来源/未确认引用”折叠展示，不白屏、不丢来源。
  - 合法引用显示“引用来源”且只展示实际使用项；无来源回答不显示占位。
  - 本地来源继续按既有授权定位行号，Web 来源继续安全打开。
  - 阅读产物完整来源快照不因聊天 UI 筛选被静默破坏；如调用方需要展示子集，应显式传入而不是覆盖原数组。
  - 默认、窄宽度、长来源标题、混合本地/Web、历史恢复均完成隔离 Tauri 验收。
- 检查命令：来源/AI Panel/reading quality/assistant export 定向测试、`npm run test:runtime-schemas`、`npm run typecheck`、`npm run lint`、`npm run build:desktop`、`npm run check:bundle:desktop`、隔离 Tauri 来源展示/跳转/重启恢复验收、`git diff --check`。
- 暂不处理：重写旧聊天正文、数据库迁移、RAG 排序优化、全量 E2E、发布门禁。

## 阶段 1 详细任务（已完成，历史留档）

### 目标

只完成阶段 1：用独立纯函数建立本轮来源注册、稳定引用 ID、正文引用解析和合法性校验，并通过测试固定四类已确认缺陷。不得接入 `useAiChat`、Agent executor、Prompt 或 UI。

### 允许修改

- `src/services/ai/sourceReferences.ts`（可新增）
- `src/services/ai/types.ts`（仅当共享类型不可避免时做可选、兼容扩展）
- `tests/agent/sourceReferences.test.ts`（可新增）
- `SOURCE_REFERENCE_FILTERING_IMPLEMENTATION_PLAN.md`

### 实施任务

1. 先检查当前 diff，确认上述文件是否已有用户修改；存在重叠时只编辑任务直接涉及的行。
2. 定义本轮来源注册表：按首次实际注入顺序分配 `S1...Sn`，同源重复注册复用 ID。
3. 定义本地与 Web 来源的确定性身份规范化，保持大小写/路径处理与项目现有来源去重约定一致，不引入文件系统读取。
4. 定义正文引用提取与注册表校验：保留原正文，返回按首次出现顺序去重的合法 ID 和对应来源。
5. 添加测试覆盖：非连续原始编号、跨工具重复来源、混合来源、未知/重复 ID、无引用、格式异常、标记后仍有正文、旧来源缺少新增可选字段。
6. 执行本阶段检查；根据真实结果更新“当前状态”和“阶段历史”，完成后把当前阶段切换到阶段 2 并停止。

### 验收标准

- [x] 注册结果只来自实际输入候选，引用 ID 在本轮内稳定且连续。
- [x] 相同来源复用 ID，不同来源不会因数组压缩或工具调用边界错映。
- [x] 引用解析只识别合法 `[S数字]`，并按正文首次出现顺序去重。
- [x] 未知引用被忽略；空、缺失、格式异常返回安全降级信息。
- [x] 任何输入都原样保留回答正文，不执行切片、尾部标记剥离或内容重写。
- [x] 本阶段定向测试、typecheck、定向 ESLint 和 diff 检查实际通过。

### 检查命令

```powershell
npx vitest run tests/agent/sourceReferences.test.ts tests/rag/ragContext.test.ts --maxWorkers=1
npm run typecheck
npx eslint src/services/ai/sourceReferences.ts tests/agent/sourceReferences.test.ts
git diff --check -- src/services/ai/sourceReferences.ts tests/agent/sourceReferences.test.ts SOURCE_REFERENCE_FILTERING_IMPLEMENTATION_PLAN.md
```

若阶段 1 未修改 `src/services/ai/types.ts`，定向 ESLint 和 diff 检查中应删除该路径，不为凑命令触碰文件。

### 禁止事项

- 不修改 `useAiChat.ts`、`agent/executor.ts`、`systemPrompts.ts`、`aiChatFlow.ts`、`AiPanel.tsx` 或 chat store。
- 不删除当前 `[有效来源]` 实现；该替换属于阶段 2/3，阶段 1 只建立可验证的新契约。
- 不新增依赖、数据库字段、迁移、配置、设置项或 Provider 专用结构化输出。
- 不运行真实模型，不读取真实知识库或用户聊天数据。
- 不执行全量测试、全量 E2E、发布门禁、提交或推送。
- 不更新 `AI_IMPLEMENTATION_PLAN.md` 或其他计划文件。

## 当前阶段详细任务

### 阶段 4｜兼容持久化、展示与最终验收

### 目标

保留完整候选来源和可选已引用 ID，聊天界面只突出正文中合法引用的来源；旧聊天和无引用回答安全降级，不破坏导出与阅读成果的完整来源快照。

### 允许修改

- `src/services/ai/types.ts` 的兼容可选字段
- `src/stores/chatStore.ts` 的 metadata 编解码和引用状态更新
- `src/services/ai/sourceReferences.ts` 的持久化引用子集恢复辅助函数
- `src/services/agent/sourceMetadata.ts`、`src/hooks/useAiChat.ts` 的最小来源保留接线
- `src/components/ai/AiPanel.tsx`、阶段 4 直接测试、本文件

### 实施任务

1. 保存完整去重候选来源，并以可选 `referencedSourceIds` 保存正文首次出现的合法引用；旧 metadata 缺字段时安全回退。
2. Agent/Direct 生产路径不再用引用子集覆盖完整 `sources`；导出和阅读成果继续接收完整候选来源。
3. AiPanel 有合法 ID 时只展示实际引用项；无 ID、空引用或全无效 ID 时折叠展示“检索来源/未确认引用”。
4. 保持本地来源授权与行号跳转、Web 安全打开、聊天正文和历史关联不变。
5. 完成定向自动检查，并在隔离 Tauri 数据目录中做默认、窄宽度、长标题、混合来源和重启恢复人工验收；未完成的真实桌面项不得标记阶段完成。

### 检查命令

```powershell
npx vitest run tests/agent/sourceReferences.test.ts tests/agent/chatMessageMetadata.test.ts tests/agent/aiChatOrchestration.test.ts tests/agent/readingQuality.test.tsx tests/agent/assistantMessageExport.test.ts tests/agent/readingArtifacts.test.ts --maxWorkers=1
npm run test:runtime-schemas
npm run typecheck
npm run lint
npm run build:desktop
npm run check:bundle:desktop
git diff --check
```

### 禁止事项

- 不重写旧聊天正文，不做数据库迁移，不清空或重建用户数据。
- 不覆盖完整 `sources`，不把 UI 展示子集写回导出或阅读成果快照。
- 不扩大文件权限，不新增 WebView 直连或外部副作用。
- 不提交、推送、打 tag、创建 Release 或 PR。

## 阶段历史

### 阶段 1｜稳定引用契约与回归基线

- 状态：已完成
- 完成内容：新增纯函数来源注册表；按规范化本地路径/行号和 Web URL 去重；分配本轮连续 `S1...Sn`；解析正文内合法引用并按首次出现顺序去重；保留完整正文并覆盖旧来源兼容与已确认缺陷。
- 验证结果：来源专项测试与 RAG 上下文测试共 15 项通过；`npm run typecheck`、定向 ESLint、`git diff --check` 通过。
- 遗留问题：尚未接入 Direct RAG，按阶段 2 处理。

### 阶段 2｜Direct RAG 稳定引用接入

- 状态：已完成
- 完成内容：RAG 上下文仅在 Direct 路径启用连续稳定 `S1...Sn`；预算跳过项不占用编号；Direct 流式和非流式回答统一解析正文内合法引用；无合法引用时保留候选来源；移除 Direct 对尾部 `[有效来源]` JSON 的依赖。
- 验证结果：定向 Vitest 4 个文件共 24 项通过；`npm run typecheck` 通过；`npm run lint` 通过（38 个既有 warning，无 error）；定向 ESLint、`git diff --check` 通过。
- 遗留问题：Agent 多工具来源接入按阶段 3 处理；来源持久化、UI 展示和真实 Tauri 验收按阶段 4 处理。

### 阶段 3｜Agent 多工具来源接入

- 状态：已完成
- 完成内容：Agent 知识检索、选区读取、授权文件读取和 Web 搜索结果在进入模型前统一注册稳定引用 ID；跨多次工具调用及复用结果按规范化来源去重；搜索结果截断后只注册模型实际可见的来源，并在工具 JSON 中加入 `[S#]` 标签；直接回答与最终综合/工具上限/deadline 出口统一携带注册表并校验正文引用；移除 Web 工具的数组位置来源编号。
- 验证结果：阶段 3 定向 Vitest 3 个文件共 26 项通过；`npm run test:selection-context`、`npm run typecheck`、`npm run lint`、定向 ESLint、`git diff --check` 通过；Lint 为 0 error、38 个既有 warning。
- 遗留问题：来源持久化、聊天恢复、UI 展示和真实 Tauri 验收按阶段 4 处理。

### 阶段 4｜兼容持久化、展示与最终验收

- 状态：已完成
- 完成内容：新增可选 `ChatMessage.referencedSourceIds`；chat metadata 保存和恢复完整候选来源及引用 ID；Direct/Agent 路径保留完整候选来源并单独更新合法引用；AiPanel 对合法引用显示“引用来源”，旧消息和无引用显示“检索来源/未确认引用”；导出和阅读成果继续使用完整来源快照；网页来源在注册、恢复和解码边界仅接受 HTTP(S)。
- 验证结果：6 个定向 Vitest 文件共 78 项通过；`npm run test:runtime-schemas`、`npm run typecheck`、`npm run lint`（40 个既有 warning、0 error）、`npm run build:desktop`、`npm run check:bundle:desktop`、`git diff --check` 通过；专用 identifier `com.guanmo.app.codex-stage14-20260818` 隔离 Tauri 在默认/窄宽度/长标题/混合来源/本地 L8–10 跳转/重启恢复场景通过。
- 遗留问题：无。
