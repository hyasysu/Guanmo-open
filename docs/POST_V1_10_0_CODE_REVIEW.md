# v1.10.0 之后的代码审查与待修复清单

审查日期：2026-10-10。状态：2 项 P1 已完成代码修复与定向机器验证，真实桌面验收待补。首次审查仅新增报告；随后用户授权执行修复。R1/R2 修复及本报告按用户指令纳入本地提交，未执行远程操作。

## 补充修复记录 · R1 验收返修 · 2026-10-10

- 验收实际 HEAD 为 `87720cc`；相对报告原 HEAD `2ca6ced` 新增侧栏动画提交，与 R1/R2 源码无交集。R2 独立审查零 finding；分类修复与既有原始选区、阅读成果来源改动保持原状。
- R1 发现并修复两项 P1：部分失败后的重复恢复清空有效客户端；空地址同步直接返回却被计为成功，导致全部实际 metadata 查询失败仍 resolve。修复前新增两项测试已分别复现客户端未初始化异常和 Promise 错误成功。
- `syncDesktopCredential()` 返回是否已确认当前目标 metadata；空/无效地址、被新请求取代或旧目标迟到结果返回 false。恢复跳过空地址，只有 true 才计成功，实际查询全部失败仍拒绝并保留重试。
- 凭据状态未变的 metadata 查询保留客户端和 `credentialVersion`；显式替换、删除、迁移仍触发失效。记录已成功写入但尚未发布的变更，避免紧随写入的 metadata 查询吞掉失效通知。原生确认、Rust 接口、旧密钥及持久化格式不变。
- 本轮修改：`src/services/settingsSecrets.ts`、`src/stores/settingsStore.ts`、`tests/services/settingsSecrets.test.ts`、外部 HTTP 契约及本报告。新增四项定向测试，覆盖重复恢复、全部查询失败加空地址、写入后紧接查询、旧目标迟到结果；原有失败保留、重试、共享 Promise、目标切换测试继续通过。
- 本轮 PASS：`npx vitest run tests/services/settingsSecrets.test.ts tests/settings/settingsCompatibility.test.ts tests/services/desktopApiKeyControl.test.tsx --maxWorkers=1`（3 文件 / 70 项）；`npm run test:smoke`（2 文件 / 8 项）；`npm run typecheck`；`npx eslint src/services/settingsSecrets.ts src/stores/settingsStore.ts tests/services/settingsSecrets.test.ts`。
- R2 Rust 16 项及数据库定向验证复用下方已有实际 PASS，本轮未重跑 Rust、全量测试或构建。真实 DPAPI 确认/取消、桌面 AI 状态与对话、设置页备份导入仍为 NOT TESTED。
- 当前完成源码修复、定向机器验证与 diff 自审；本轮修改尚未独立模型复验。建议 L3 提示词：`使用 ai-code-review Skill 复验 R1 返修，重点核实重复恢复保留客户端、同步成功计数及排队写入失效；复用本轮 PASS，原生待验项保持 NOT TESTED，不修改代码。`

## 修复记录 · 2026-10-10

- R1：按连接隔离旧凭据迁移失败，始终尝试同步当前连接 metadata。部分失败提示受影响类型、保留重试，允许调用方初始化有效连接；所有 metadata 同步失败仍抛错。已成功处理的原目标从待迁移清单移除，失败项继续使用原目标，不绑定新地址。
- R2：分类名称优先匹配本地记录；没有同名项但 ID 已存在时，本地名称优先，避免改名破坏前面已经映射的其它分类。备份引用统一映射、去重，整个恢复保持单一 Rust/SQLx 事务。
- 修改：`src/services/settingsSecrets.ts`、`tests/services/settingsSecrets.test.ts`、`src-tauri/src/database_transactions.rs`（含原生回归测试）、外部 HTTP/数据库契约和本报告。未改写其它既有业务修改或任务计划。
- PASS：4 个定向 Vitest 文件 / 72 项；Rust 数据库事务模块 16 项（含七种分类冲突组合、重复导入和既有回滚用例）；最终 Core Smoke 2 文件 / 8 项；Typecheck、改动文件 ESLint、Rust 文件格式检查、diff 格式检查。
- 最终定向命令：`npx vitest run tests/services/settingsSecrets.test.ts tests/settings/settingsCompatibility.test.ts tests/database/transactionBridge.test.ts tests/database/artifactOrganization.test.ts --maxWorkers=1`；`cargo test --manifest-path src-tauri/Cargo.toml --lib database_transactions::tests --jobs 1 -- --test-threads=1`；`npm run test:smoke`；`npm run typecheck`；`npx eslint src/services/settingsSecrets.ts tests/services/settingsSecrets.test.ts`；`rustfmt --edition 2021 --check src-tauri/src/database_transactions.rs`；`git diff --check`。
- R1 增加无效可选地址、修正当前地址、取消单类型迁移的回归；R2 增加同名不同 ID、同 ID 同名/异名、交叉名称冲突、多个备份 ID 合并到同一分类以及改名影响已映射引用的回归。
- NOT TESTED：真实 DPAPI 确认/取消、安装版 AI 状态与对话、设置页真实备份导入。Rust 测试编译和内存 SQLx 事务已实际执行，不能据此宣称原生 UI 验收通过。
- 下面的问题描述和原审查验证记录保留作为历史复现依据；不是对修复后源码仍存在缺陷的声明。

## 1. 范围与结论边界

- 基线：`v1.10.0^{commit}` = `fd5defcade11862b0c11e586a267342e334d2665`。该 tag 为附注 tag；`git rev-parse v1.10.0` 返回的 tag 对象不是提交基线。
- 终点：HEAD `2ca6ced72f124e5107413acd7e482a32245c0371`。
- 范围：基线之后全部 12 个提交；最终净变更为 99 个文件、5280 行新增、1996 行删除。按提交核对范围，审查最终仍生效的实现、契约和对应回归；问题须在当前状态仍成立。
- 同时核查当前未提交的原始选区、阅读成果来源与相关持久化/UI 改动。它们与已提交问题分开归属，不将用户现有改动回退或夹带提交。
- 使用知识图辅助定位，再以当前 diff、源码调用链和实际执行证据核实。图索引落后 HEAD，空调用链和测试缺口不能作为缺陷结论；未重建图或 embedding。
- README 与截图变更核对引用和交付范围；未对截图作完整视觉验收。`.workbuddy/` 与 `src-tauri/target-reading-position-baseline/` 是既有未跟踪目录，未扫描其内容。
- 这是代码审查与定向机器验证，不是发布验收。真实 WebView、原生权限、DPAPI、Rust 编译及安装版交互均不能由本报告的前端测试证明。

## 2. 待修复问题

### R1 · [P1] 一个无效的可选旧配置阻断全部桌面凭据状态恢复

**状态：代码修复与定向验证完成，真实桌面待验。置信度：HIGH。引入提交：`271c26e`。**

定位：`src/services/settingsSecrets.ts:10–24`；关联 `src/stores/settingsStore.ts:428–451,593–628`、`src/hooks/useAiChat.ts:157–166`、`src/App.tsx:168–205`、`src-tauri/src/api_credentials.rs:45–94`。

**触发条件**

1. 对话配置及其原生绑定凭据有效，使用需要密钥的公网 API。
2. 旧设置仍保存一个非空但无效的自定义搜索地址，或 Rust 不支持的其他连接配置；搜索不必处于启用状态。
3. 重启后调用 `ensureSettingsSecretsHydrated()`；Rust 对该配置拒绝规范化。

**实际问题**

恢复函数先依次处理全部旧凭据与启动时捕获的 `originalTargets`，然后才同步三个类型的凭据状态。任一连接失败会提前退出，所有 `syncDesktopCredential()` 均不执行。Store 在持久化恢复时将密钥状态初始化为未配置，因此有效对话连接仍显示缺少凭据，客户端初始化/使用受阻；原生密钥本身没有据此丢失。

`originalTargets` 在模块初始化时固定捕获。即使用户后来修正当前搜索地址，再次恢复仍会尝试旧的无效地址；仅清空共享 Promise 并不能修复这条恢复链。单独编辑对话配置触发状态同步可能绕过部分症状，但不能使整体恢复流程成功。

**执行证据**

用 esbuild 在内存中打包实际 `settingsSecrets.ts`；仅 mock Tauri 环境、连接配置、原生配置失败及 metadata 发布。无旧明文凭据，chat/embedding 均有效，search 初始为无效非空地址。第一次恢复拒绝且 metadata 同步次数为 0；把当前 search 改为有效 HTTPS 地址后，第二次恢复仍拒绝且同步次数仍为 0：

```text
attempt=1, currentSearchFixed=false, rejected=true, metadataSync=[]
attempt=2, currentSearchFixed=true,  rejected=true, metadataSync=[]
```

这是实际前端恢复控制流的匿名错误注入复现；原生 Rust/DPAPI 完整场景仍为 NOT TESTED。现有 `settingsSecrets.test.ts` 全局失败后重试用例未覆盖“仅一个可选连接失败且其它连接有效”。

**建议修复边界**

- 各连接的旧数据迁移分别处理失败，随后仍同步有效的当前连接 metadata；错误应能指出受影响类型，不能将部分失败等同于全部密钥未配置。
- 原目标与当前目标分开管理：未迁移旧凭据必须保留原目标、原生确认和可重试数据；不能猜测新 Origin、删除旧槽位或把旧密钥自动绑定到用户新地址。
- 不能只吞掉外层异常，也不能仅跳过所有旧数据迁移。

**修复验收**

1. 无效/未启用的旧 search 配置不阻断有效 chat/embedding 状态恢复及聊天。
2. 修正当前可选配置后，同一会话可以继续使用有效连接；旧目标的失败不永久阻断全局恢复。
3. 单一类型迁移失败、用户取消原生迁移确认时，其它类型仍可用；失败项原数据保留。
4. 目标切换、迟到结果、重复恢复不发布旧目标状态、不把旧密钥绑定到新 Origin。

### R2 · [P1] 同名不同 ID 的分类导致合法备份整包导入失败

**状态：代码修复与 SQLx 定向验证完成，真实设置页待验。置信度：HIGH。引入提交：`76be871`。**

定位：`src-tauri/src/database_transactions.rs:969–976,998–1014`；关联 `src/services/database/schema.ts:188–190`、`src/services/database/persistence.ts:941–945`。

**触发条件**

1. 本地已有分类，例如名称“同名分类”、ID `local-category`。
2. 从另一独立实例导出的合法备份，包含同名分类，但 ID 为 `backup-category`；同库删除分类后重建同名分类，再恢复旧备份也能形成这种状态。
3. 使用设置中的“导入备份”。

**实际问题**

分类表对 `name` 施加 UNIQUE 约束，而导入只处理 `ON CONFLICT(id)`。同名不同 ID 不进入该冲突分支，直接报 `UNIQUE constraint failed: reading_artifact_categories.name`。分类写入位于会话、消息、成果等恢复共用的 SQLx 事务内，因此此前写入也无法提交，整个备份导入失败。

这是恢复兼容性问题；不会据此删除已有本地数据。普通创建分类时拒绝重名是合理约束，但导入合法备份需要明确的冲突处理规则，不能要求用户先删除既有分类来绕过。

**执行证据**

从实际 schema 提取建表 SQL，从实际 Rust 导入函数提取分类 UPSERT SQL，在 Node 内存 SQLite 中执行：先保存本地分类，开启事务写入一条匿名备份内容，再导入同名不同 ID 分类。执行结果：

```text
error=UNIQUE constraint failed: reading_artifact_categories.name
localCategories=1, importedRows=0（捕获错误后执行 ROLLBACK）
```

该探针确认真实 SQL 的冲突与 SQLite 回滚行为。生产 SQLx 事务未实际运行；其错误传播及不提交路径由源码确认。现有分类/迁移/备份测试通过，但未覆盖这个冲突组合。

**建议修复边界**

- 在同一 Rust 事务中制定名称冲突策略：可复用已有同名分类，并将备份里的分类引用统一映射到本地 ID；同 ID 改名又撞到另一分类的情况也必须有明确规则。
- 若产品选择让用户决策，应在写入前识别冲突并给出具体操作，不直接抛出原始 UNIQUE 错误。
- 保留本地分类、收藏、成果与原文；不清空数据库，不静默丢弃分类关联，不在前端拼接事务。

**修复验收**

1. 同名不同 ID、同 ID 同名、同 ID 不同名及交叉名称冲突均按明确规则处理。
2. 映射后所有 `artifactOrganization.categoryIds` 正确，收藏和成果内容保留。
3. 重复导入不会新增重复分类；旧备份缺少分类字段仍能导入。
4. 其它非法数据仍使整个事务回滚，不以部分成功破坏原子性。

## 3. 全部提交的覆盖记录

| 提交 | 修改主题 | 核查重点 |
| --- | --- | --- |
| `8d8fea6` | README、模块介绍、截图 | 文档引用与变更范围；截图视觉未验收 |
| `41fbc3d` | 翻译与知识库快捷预设 | 默认命令、旧自定义配置保留 |
| `0c6496d` | 阅读成果卡片与原问题折叠 | 布局限制、独立折叠、后续分页交互 |
| `64d1f19` | 保存队列、竞态、另存为保护 | Tab 身份、同路径串行、正文版本、关闭及另存为 |
| `da81f3f` | 右键菜单 Portal | 挂载层、事件清理、定位与现有消费入口 |
| `271c26e` | Rust 密钥隔离与绑定 | 旧配置迁移、状态恢复、目标绑定、失败保护；发现 R1 |
| `25df398` | 精确代理操作及限额 | 端点/路径/协议、队列取消、响应反射过滤、RAG 限额停止 |
| `76be871` | 收藏分类与备份 | schema v4、事务、筛选先于分页、删除边界、恢复；发现 R2 |
| `9cb64f2` | 删除后分页及选中复制 | 最后一项删除、分页归一、事件与卡片文本选择 |
| `0d9781c` | CSP、ACL、图表安全 | 构建策略、command 清单、渲染入口、HTML/SVG 限制 |
| `7e394cf` | Agent 上下文超限恢复 | 明确错误、完整历史轮裁剪、本轮保护、一次恢复与取消 |
| `2ca6ced` | 搜索失效、重绑、替换坐标 | EditorView 生命周期、全文预览投影、快切与旧结果、清层 |

未提交改动另行核查：原始选区服务/UI、AI Panel 来源、阅读成果状态与持久化、相应测试及数据库契约。未确认其中存在本次新增的 P0/P1 缺陷。此结论不表示真实桌面来源定位已验收。

## 4. 本次机器验证

测试在当前工作区执行，包含既有未提交改动；不是干净 HEAD 的独立复测。

| 检查 | 结果 |
| --- | --- |
| `npm run test:smoke` | PASS：2 文件 / 8 项 |
| 第一组定向 Vitest | PASS：8 文件 / 93 项 |
| 第二组定向 Vitest | PASS：18 文件 / 207 项 |
| `npm run test:ai-http -- --frontend-only` | PASS：前端代理/IPC/SSE/取消检查；脚本明确标记 Rust NOT TESTED |
| R1 匿名错误注入探针 | 已复现缺陷：修改当前配置后仍阻断，metadata 同步为 0 |
| R2 匿名内存 SQLite 探针 | 已复现缺陷：名称唯一约束失败，事务内匿名内容回滚 |
| 报告 `git diff --check` 与范围核查 | PASS；最终交付前执行 |

第一组命令：

```powershell
npx vitest run tests/editor/documentSave.test.tsx tests/editor/SearchOverlay.boundary.test.tsx tests/agent/contextOverflowRecovery.test.ts tests/database/artifactOrganization.test.ts tests/database/databaseMigrations.test.ts tests/services/settingsSecrets.test.ts tests/services/renderingSecurity.test.ts tests/services/echartsOption.test.ts --maxWorkers=1
```

第二组命令：

```powershell
npx vitest run tests/agent/ArtifactOrganizationControls.test.tsx tests/agent/ReadingArtifactCenter.pagination.test.tsx tests/agent/ReadingArtifactCenter.test.tsx tests/components/ContextMenu.test.tsx tests/editor/SearchOverlay.preview.test.tsx tests/editor/previewTabSwitchRegression.test.tsx tests/markdown-preview-prototype/html-sanitize.test.tsx tests/rag/embeddingInput.test.ts tests/services/desktopApiKeyControl.test.tsx tests/settings/settingsCompatibility.test.ts tests/web/browserFileSystem.test.ts tests/agent/AiPanel.artifactSource.test.tsx tests/agent/originalSelections.persistence.test.ts tests/agent/originalSelections.test.ts tests/agent/aiPanelInteractions.test.tsx tests/agent/readingArtifactsBackup.test.ts tests/agent/readingArtifactsStore.test.ts tests/services/readingArtifactCenter.test.ts --maxWorkers=1
```

Vitest 共 308 项通过。jsdom 输出既有 `Window.scrollTo()` 未实现提示，不作为真实滚动验收，也没有据此掩盖测试失败。

**NOT TESTED**：本次未运行全量测试、全仓 Lint/Typecheck、Web/Desktop 构建、Rust fmt/check/clippy/test、真实网络及 DPAPI 迁移、原生 ACL/CSP、安装版搜索/保存/来源定位、冷启动性能和截图视觉验收。未引用历史 PASS 充当本次运行结果。未调用独立模型 Reviewer。

## 5. 后续验收交接

1. 代码修复已完成。后续用匿名测试配置/数据库在新鲜桌面产物验收：无效可选配置不阻断有效对话、迁移取消保留原数据、同名分类备份导入和重复导入。
2. 继续工作前重新读取 `AGENTS.md`、`docs/AI_REVIEW_PROJECT.md` 及密钥/数据库契约，重新确认工作区状态。不要覆盖既有原始选区与阅读成果改动。
3. 风险涉及凭据兼容和数据库事务，按 HIGH 候选、L3 验收；仅执行直接决定验收的定向门禁，不自动跑全套或构建安装包。
4. 建议独立验收提示词：`使用 ai-code-review Skill 审查 R1/R2 修复 diff，重点核实失败隔离、旧密钥原目标和原生确认、分类 ID 映射及事务回滚；复用实际机器证据，未执行的原生项目保持 NOT TESTED。` 建议高推理模型。

首次审查唯一新增交付物为此报告；后续修复范围见顶部记录。既有修改、未跟踪源码/测试和本地产物目录均保留；没有改写 `AI_IMPLEMENTATION_PLAN.md`。

## 附录：已提交净变更文件清单

以下由 `git diff --name-only v1.10.0 HEAD` 生成，用于后续审查/修复范围核对；路径不意味着该文件单独完成原生验收。

- `AI_IMPLEMENTATION_PLAN.md`
- `README.md`
- `docs/agent-contracts/database.md`
- `docs/agent-contracts/desktop-services.md`
- `docs/agent-contracts/external-http.md`
- `docs/agent-contracts/markdown-editor.md`
- `docs/architecture/state-ownership.md`
- `docs/images/guanmo-annotations.png`
- `docs/images/guanmo-fullscreen-ai.png`
- `docs/images/guanmo-fullscreen-background.png`
- `docs/images/guanmo-fullscreen-focus.png`
- `docs/images/guanmo-fullscreen.png`
- `docs/images/guanmo-main-warm.png`
- `docs/images/guanmo-reading-artifacts.png`
- `docs/images/guanmo-screenshot-2026-06-12.png`
- `docs/images/guanmo-screenshot.png`
- `docs/images/guanmo-theme-dark.png`
- `docs/images/guanmo-theme-light.png`
- `docs/images/guanmo-theme-warm.png`
- `docs/images/guanmo-theme.png`
- `docs/web-deploy.md`
- `scripts/ai-http-transport-check.ts`
- `scripts/run-ai-http-transport-check.mjs`
- `scripts/webCsp.ts`
- `src-tauri/build.rs`
- `src-tauri/capabilities/default.json`
- `src-tauri/permissions/main.toml`
- `src-tauri/src/api_credentials.rs`
- `src-tauri/src/api_http.rs`
- `src-tauri/src/api_http_limits.rs`
- `src-tauri/src/database_transactions.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`
- `src/App.tsx`
- `src/components/common/CommandPalette.tsx`
- `src/components/common/ContextMenu.tsx`
- `src/components/editor/CodeMirrorEditor.tsx`
- `src/components/editor/EChartsBlock.tsx`
- `src/components/editor/EditorArea.tsx`
- `src/components/editor/MarkdownPreview.tsx`
- `src/components/editor/SearchOverlay.tsx`
- `src/components/editor/markdownPreviewTypes.ts`
- `src/components/reading-artifacts/ArtifactOrganizationControls.tsx`
- `src/components/reading-artifacts/ReadingArtifactCenter.tsx`
- `src/features/settings/DesktopApiKeyControl.tsx`
- `src/features/settings/SettingsPage.tsx`
- `src/hooks/useAiChat.ts`
- `src/hooks/useFileOperations.ts`
- `src/services/agent/executor.ts`
- `src/services/ai/aiClient.ts`
- `src/services/ai/contextBudget.ts`
- `src/services/ai/providers/openaiCompatible.ts`
- `src/services/ai/types.ts`
- `src/services/aiChatFlow.ts`
- `src/services/aiChatMessages.ts`
- `src/services/aiShortcutActions.ts`
- `src/services/apiConnection.ts`
- `src/services/browserFileSystem.ts`
- `src/services/database/artifactOrganization.ts`
- `src/services/database/db.ts`
- `src/services/database/persistence.ts`
- `src/services/database/readingArtifactCenter.ts`
- `src/services/database/schema.ts`
- `src/services/documentSave.ts`
- `src/services/echartsOption.ts`
- `src/services/externalHttp.ts`
- `src/services/fileEntryActions.ts`
- `src/services/fileSystem.ts`
- `src/services/legacyApiCredentials.ts`
- `src/services/rag/pipeline.ts`
- `src/services/secureStorage.ts`
- `src/services/settingsSecrets.ts`
- `src/services/webSearch.ts`
- `src/stores/editorStore.ts`
- `src/stores/settingsStore.ts`
- `src/web/WebSettingsPage.tsx`
- `src/web/externalHttp.ts`
- `src/web/secureStorage.ts`
- `tests/agent/ArtifactOrganizationControls.test.tsx`
- `tests/agent/ReadingArtifactCenter.pagination.test.tsx`
- `tests/agent/ReadingArtifactCenter.test.tsx`
- `tests/agent/contextOverflowRecovery.test.ts`
- `tests/components/ContextMenu.test.tsx`
- `tests/database/artifactOrganization.test.ts`
- `tests/database/databaseMigrations.test.ts`
- `tests/editor/SearchOverlay.boundary.test.tsx`
- `tests/editor/SearchOverlay.preview.test.tsx`
- `tests/editor/documentSave.test.tsx`
- `tests/editor/previewTabSwitchRegression.test.tsx`
- `tests/markdown-preview-prototype/html-sanitize.test.tsx`
- `tests/rag/embeddingInput.test.ts`
- `tests/services/desktopApiKeyControl.test.tsx`
- `tests/services/echartsOption.test.ts`
- `tests/services/renderingSecurity.test.ts`
- `tests/services/settingsSecrets.test.ts`
- `tests/settings/settingsCompatibility.test.ts`
- `tests/smoke/CoreSmoke.test.tsx`
- `tests/web/browserFileSystem.test.ts`
- `vite.config.ts`
