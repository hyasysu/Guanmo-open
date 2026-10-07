# 观墨保存可靠性、API 安全加固与 Agent 超限恢复｜阶段任务

> 本文件是本任务唯一状态来源。使用 staged-task-handoff 恢复任务，以当前源码和实际验证为准。2026-10-05 按用户授权覆写旧架构治理计划；旧计划的完成记录和未验收事项不属于本任务，也不据此宣称已验收。

## 当前状态

- 当前阶段：阶段 1｜统一保存队列与竞态修复
- 阶段状态：进行中
- 当前授权：2026-10-07 用户要求逐阶段实施直到需要新窗口；本轮实施阶段 1，阶段边界按验证与上下文决定，不要求重复授权。
- 上次执行结果：统一 documentSave 共享队列已接入自动、手动、预览勾选、命令面板、文件菜单与另存为；成功只更新保存基线，下载不清脏。
- 验证结果：保存/浏览器/文档模型/预览 75 项、类型检查、Lint、Store/文件权限边界、Core Smoke 8 项、Desktop 前端构建与体积门禁 PASS；Rust Release 构建因内存不足 FAIL，原生验收与新产物冷启动对照 NOT TESTED。
- 本阶段剩余：2026-10-07 用户明确要求验收暂缓；暂不重试构建或原生验收。后续恢复时生成新鲜 Tauri 产物，完成匿名临时文件原生保存验收与启动对照；通过后才标记完成并进入阶段 2。
- 本阶段允许修改：见下方“允许修改”；必要扩展 CommandPalette、fileEntryActions 和浏览器句柄测试，修复遗漏的文档保存旁路。
- 阻塞问题：Rust 报 memory allocation of 18288 bytes failed / STATUS_STACK_BUFFER_OVERRUN；单 Cargo worker 重试同样失败，PowerShell 也报 Out of memory。现有 EXE 仍是 2026-10-05 旧产物，不可用于本轮验收。
- 下一阶段：阶段 2｜Web API Key 常驻安全提示；未开始，可独立交付；完整顺序与依赖见“开发优先级”。
- 工作区基线：本轮开始时 `AI_IMPLEMENTATION_PLAN.md` 已修改；保留既有保存队列和 Agent 方案。未跟踪 `.workbuddy/`、`src-tauri/target-reading-position-baseline/` 保留，不清理、不夹带。
- Git 边界：2026-10-07 用户已授权本次阶段 1 相关文件本地提交；未授权推送、打 tag、创建 Release 或 PR。

## 项目目标与评估结论

本计划包含保存可靠性、API 密钥与 XSS 安全加固、Agent 超限恢复三项；以下保存成功标准仅适用于阶段 1，安全专项标准见阶段 2–5。所有新增阶段均未开始，源码核实不等于安全验收或漏洞已复现。

值得修改。写前快照校验只能淘汰尚未启动的旧任务，无法给已经发出的异步保存建立顺序；应由应用级、按文件身份分组的协调器串行写入，并统一处理保存确认、失败重试和索引调度。

成功标准：同一文件最多一个执行中的写入和一个可替换的待写快照；不同文件可独立保存；停止编辑且写入成功后，磁盘为最新有效保存快照。迟到结果不能覆盖当前正文，只有当前正文等于最后成功写入内容时才显示为已保存。

### 已核实的当前链路

| 位置 | 当前事实与影响 |
|---|---|
| `src/hooks/useFileOperations.ts` | 自动保存按 Tab 定时，写前检查 modified、filePath、内容快照；发出 saveFile 后没有同路径锁。失败按旧内容再次定时，计数按 Tab，最多 3 次失败。手动保存也直接调用 saveFile/saveFileAs。 |
| `src/components/layout/AppLayout.tsx`、`src/components/editor/EditorArea.tsx` | 两处调用 useFileOperations，都会运行其中的自动保存 effect；后者还单独实现 handleSave。队列不能放在某个 Hook 实例的 ref 中。 |
| `EditorArea.tsx` 的 persistTabContent | 预览勾选先更新正文，再写文件；完成后 replaceTabContentWithSaved 用旧快照覆盖 content，并无条件清除 modified。此时发生新编辑会被覆盖。预览块提交只更新 Tab，随后走自动保存。 |
| `src/stores/editorStore.ts` | markTabSaved 已按当前 content 与已写内容比较 modified；这部分不是无条件清脏，但只检查 id。saveTabAs 还会替换正文，需防选择器/写入期间的新编辑丢失。 |
| `src/services/fileSystem.ts` | saveFile 是物理保存适配；桌面 saveFileAs 直接 writeFile，浏览器 saveBrowserFileAs 内部直接写入，需要防另存为绕过统一入口。 |
| `src/hooks/useTauri.ts`、`src-tauri/src/lib.rs` | 受限 writeFile 最终调用同步 Rust command write_text_file_by_path，再执行 fs::write。没有确认原生 IPC 的实际乱序行为；前端缺少顺序契约不等于已经实测到磁盘回退。 |
| `src/services/pathIdentity.ts` | 现有 normalizeFilePath/isSameFilePath 处理大小写、分隔符和 Windows 长路径前缀；规范化仅用于身份比较，写盘仍传原始授权路径。 |
| `src/services/rag/indexer.ts` | 已有按路径的索引 PendingLatest；保存端只调整成功快照与调度入口，不重建索引队列。 |

本轮没有实施或尝试代码修复，没有失败测试记录。不要复用旧任务文档的测试通过记录作为本任务证据。

## 技术与总体约束

- 现有 React、TypeScript、Zustand、Tauri 2、Vitest；阶段 1 不新增依赖或保存设置。安全专项优先复用现有 DPAPI、安全存储和清洗链路；确需新增依赖时先核实体积、加载边界与兼容性，不默认引入另一套密钥库。
- Tab.content 是编辑正文真相；savedContent 是最近确认成功写入的基线；modified 按两者比较维护。队列是临时执行状态，不持久化，不创建第二份业务正文。
- 只保证本应用当前运行实例中经过统一入口的文档保存顺序；外部程序写入、跨进程锁、符号链接/硬链接身份、断电原子写入和退出阻塞保存不在本阶段。
- 保留 .md 限制、授权边界、原位保存与浏览器下载回退；阶段 1 不修改 Rust command、FsAccessState、DB schema、旧持久化格式。阶段 3–5 仅按其明确范围修改安全命令、HTTP 代理、配置和渲染边界，不改业务 DB schema。
- 不把所有文件操作排成一个全局 FIFO，也不把图片、导出、索引文件等无关写入纳入文档队列。
- 修改前重新读取根目录及目标目录规则、git status；保留全部既有改动。命中范围外必需改动时先说明，不顺带重构。

## 阶段计划

### 开发优先级与阶段依赖

| 顺序 | 阶段 | 原因与依赖 |
|---|---|---|
| 1 | 统一保存队列与竞态修复 | 保持当前阶段；用户正文覆盖风险优先，先完成已有保存闭环。 |
| 2 | Web API Key 常驻安全提示 | 小范围、独立交付，尽早明确现有三种存储模式的风险。 |
| 3 | 桌面密钥仅由 Rust 读取与使用 | 移除长期前端明文和读取接口，减少密钥外泄面；复用现有 DPAPI。 |
| 4 | Rust 代理操作约束与滥用限额 | 依赖阶段 3 的密钥绑定；限制读不到 Key 后仍能借代理发请求的空间。阶段 3、4 是安全闭环，不能只完成迁移就宣称防滥用完成。 |
| 5 | CSP、不可信渲染与 Tauri 权限加固 | 分入口验证防注入与最小权限；核实最终请求链路后收紧 CSP，避免破坏正常渲染与本地模型。 |
| 6 | Agent 按需上下文超限恢复 | 原阶段 2，方案保留；已有有界重试入口，暂排在数据可靠性与安全加固之后，无保存代码依赖。 |

- 本顺序是默认开发队列；2026-10-07 用户已授权逐阶段实施直到需要新窗口，每阶段先验收再推进，不同时提前实现后续阶段。阶段 2 可单独提前，阶段 5 的只读入口核实可提前；阶段 4 的正式验收依赖阶段 3。
- 若发现可稳定复现的脚本执行或 Key 外传漏洞，先报告具体证据，再把对应安全修复升为当前优先项；不把本轮静态观察当作已确认漏洞。
- 2026-10-05 历史记录中的“阶段 2”指原 Agent 任务；自 2026-10-06 起执行“阶段 2”指 Web 提示。使用任务名称消除旧编号歧义。

### 阶段 1｜统一保存队列与竞态修复

- 目标：一次交付完整保存闭环，避免只修自动保存而留下手动/预览旁路。
- 实施顺序：确定性复现 → 协调器与保存确认 → 接入各入口 → 定向检查 → 原生验收。
- 风险：HIGH；用户文件覆盖、异步竞态、共享 Tab 状态与 Hook 生命周期。验收模型建议 L3 强模型。
- 范围：下面列出的保存链路与最少相关测试。
- 完成条件：下方验收项及必要 Machine Gate 真实通过；原生未验收时阶段保持进行中。
- 暂不处理：全项目解耦、启动优化、关闭弹窗设计、退出阻塞保存、外部文件冲突系统、RAG 算法与新配置。

### 阶段 2｜Web API Key 常驻安全提示

- 状态：未开始；初步 LOW → L1。
- 目标：在 Key 配置区持续展示内存、明文与密码加密模式的运行期风险；保留原有明文保存确认。
- 范围与验收：见下方“阶段 2–5 详细任务”；不改变存储默认值、加密格式或 Web 能力。

### 阶段 3｜桌面密钥仅由 Rust 读取与使用

- 状态：未开始；初步 HIGH → L3，涉及密钥迁移、共享配置与核心 IPC 边界。
- 目标：前端传配置身份、操作与业务参数，Rust 从现有安全存储取 Key 并绑定目标；不再返回已保存明文 Key。
- 范围与验收：见下方详细任务；保留旧配置、自定义 API、本地免 Key 模型和多协议兼容。

### 阶段 4｜Rust 代理操作约束与滥用限额

- 状态：未开始；初步 HIGH → L3，依赖阶段 3。
- 目标：在已有网络与资源限制上，补齐操作/接口约束、频率与累计使用上限；由 Rust 强制执行。
- 范围与验收：见下方详细任务；不硬编码仅允许内置供应商，不承诺本地估算等于供应商账单硬上限。

### 阶段 5｜CSP、不可信渲染与 Tauri 权限加固

- 状态：未开始；初步 HIGH → L3，涉及脚本执行边界、渲染和 IPC 权限。
- 目标：收紧实际不必要的 CSP 与权限，复用现有清洗能力覆盖真实不可信渲染入口。
- 范围与验收：见下方详细任务；保留受支持的安全 Markdown、公式、图表、图片和本地模型。

### 阶段 6｜Agent 按需上下文超限恢复

- 状态：未开始；原阶段 2，完整目标、范围与验收见下方“阶段 6 详细任务”。
- 目标：正常请求直接发送，仅 Provider 明确返回上下文超限后进行确定性压缩与有界重试；不恢复默认总预算。
- 实施顺序：核实错误与请求入口 → 建立最小超限复现 → 压缩与重试接入 → 定向回归与桌面验收。
- 初步风险：MEDIUM；涉及 Agent 请求消息、异步取消、引用和重试边界。若实际修改触及工具写入执行语义，重新评估，不默认为此授权。
- 暂不处理：模型摘要调用、全局窗口配置、用户预算设置、主动总量裁剪、RAG 算法或持久化格式。

## 当前阶段详细任务

### 开始前必须读取与核实

- `AGENTS.md`、`docs/AI_REVIEW_PROJECT.md`、`docs/GUANMO_DEVELOPMENT_GUIDE.md` 保存数据流。
- `docs/architecture/state-ownership.md` 文档模型与标签页章节。
- `docs/agent-contracts/file-access.md`、`markdown-editor.md`、`rag-memory.md`、`database.md`；涉及浏览器适配时补读 `docs/web-deploy.md`。
- 全局 `guides/engineering-execution.md`、`guides/delivery.md`；确实涉及持久化格式时另读 compatibility，默认不改格式。
- 先做一次最小知识图查询；本轮图落后 HEAD，后续若仍过期直接用精确符号搜索，不重建 embedding。
- 修改 EditorArea 前按项目启动基线规则记录同机基线；仅改保存调用，不改 mount、lazy import、预热或首屏打点，不宣称性能收益。若因环境无法记录，明确保留 NOT TESTED 与对应交付限制。

### 允许修改

- `AI_IMPLEMENTATION_PLAN.md`
- 一个窄的统一保存协调器，建议 `src/services/documentSave.ts`；不预建通用框架。
- `src/hooks/useFileOperations.ts`
- `src/components/common/CommandPalette.tsx`、`src/services/fileEntryActions.ts`：源码发现的必要保存旁路，只调整保存调用。
- `tests/web/browserFileSystem.test.ts`：目标选择不提前写入与句柄身份的最小回归。
- `src/components/editor/EditorArea.tsx`：仅保存、预览勾选保存调用和必要导入。
- `src/services/fileSystem.ts`：仅保存/选择目标路径的适配边界。
- `src/stores/editorStore.ts`：仅保存确认与另存为 action 的身份保护和保留新正文。
- `src/services/browserFileSystem.ts`：仅在拆分另存为选择目标与写入时作必需调整。
- 最少的 `tests/editor/` 保存协调器/生产入口测试；已受影响的 documentModelContract、previewTabSwitchRegression、resourceLifecycle/modeResourceLeak 测试按实际需要调整。
- 不默认修改 pathIdentity、AppLayout、useTauri、Rust、RAG 实现、依赖与 CI。统一服务即使被多个 Hook 实例调用，也必须共享同一个队列。

### Blast Radius

- 真相：editorStore.tabs；正文与保存基线仍由 Store action 管理。协调器只持有待执行快照及执行序号。
- 直接链路：自动保存、Ctrl+S、编辑器 onSave、草稿另存为、预览勾选 → 唯一保存协调器 → 文件适配器 → 原有受限写入。
- 间接影响：未保存标志/提示、Tab 切换/关闭/重开/路径变更、另存为后绑定路径、多个 Hook 的重复调度、保存后索引快照。
- 风险信号：共享状态、异步竞态、effect cleanup、文件身份与用户数据写入。
- 不应变化：正文编辑方式、预览块切片/冲突机制、模式/Tab 生命周期、权限、启动恢复、索引算法和 Web 既有能力。
- 清理边界：组件 cleanup 只撤销其未提交定时器，不销毁应用级执行中队列；释放同路径执行锁必须等待实际写入结束。

### 实施方案

1. **统一入口。** 保存协调器拥有唯一的按文件身份分组的队列、成功确认和索引调度。自动、手动、预览勾选全部经过该入口；另存为先选择并授权目标，目标确定后通过同一入口写入。fileSystem 保留底层适配职责，不另建第二套队列。多处 Hook 的重复请求由共享协调器合并；不为消除重复而重构组件结构。

2. **一个执行中 + 一个待写。** 执行中快照不可更改；新有效请求替换待写快照，不积压 FIFO。相同有效版本重复请求合并。当前写入完成才启动下一次；不同路径互不阻塞。复用桌面 normalizeFilePath 作为 key，保留原始路径用于授权写入；浏览器虚拟路径沿用其句柄身份，不用规范化字符串替换实际 URI。

3. **最新版本与防抖边界。** 空闲时保留现有 autoSaveDelay；手动保存立即提交，但不能越过执行中的写入。在自动保存开启且仍是同一有效 Tab/路径时，写入结束或准备重试时重新读取最新正文，覆盖过时待写版本，即使该次编辑的防抖尚未到期，也应让正在进行的保存轮次追上最新内容。自动保存关闭时，只处理明确的手动/勾选请求，不因后续普通编辑擅自增加保存。关闭自动保存撤销尚未启动的自动任务，执行中的写入仍正确完成并确认。

4. **身份与完成回执。** 每次请求捕获 Tab id、原路径身份、内容快照及运行时执行标识；真正启动、完成确认和重试前核实身份。完成副作用由协调器统一执行，调用方不得在 await 后用捕获旧内容重复 markSaved 或调度旧索引。被替换请求只在替代版本成功写入后得到该版本的真实回执；失败/取消必须明确结算，不能假装旧版本写过，也不能留下永不结束的 Promise。正在写入的请求可在其成功后结算，但若当前内容已更新，不能给出“当前内容已全部保存”的提示。

5. **保存基线不回写正文。** 成功写 A 后可把 savedContent 更新为 A，即使此刻 content 已为 B；modified 必须仍为 true。当前 content 等于成功写入内容才清脏。预览勾选完成后取消 replaceTabContentWithSaved 式的旧正文覆盖。Tab 已关闭、原路径已变或旧实例已失效时，不对当前 Tab 做迟到写回；未启动的失效请求取消。保留同路径执行锁至旧写入结束，避免关闭/重开产生并发写。

6. **另存为保留编辑。** 防止同一草稿的重复手动操作启动多个并行选择器或迟到路径绑定。选择目标后读取该草稿当前有效正文再提交；写入期间的新编辑保持在 content 中，成功只绑定仍有效的 Tab/目标并更新基线，不能用 saveTabAs 的旧快照覆盖新正文。若自动保存开启，绑定后最新未保存正文继续由同一目标队列保存。选择器取消不写入、不改路径、不清脏。

7. **有界失败重试。** 自动保存沿用最多 3 次失败的上限与现有延迟，不做无限重试；每次重试取最新有效请求，不重试闭包中的旧内容。连续失败预算不因重复 effect/普通编辑无限刷新；成功清除预算，达到上限后停止自动重试并保留脏状态与现有错误提示，用户再次手动保存可显式开启新一轮。失败与新请求仍在同一锁内串行处理；清理计时器和等待者，不留 unhandled rejection。手动保存保留可观察错误，不能无限等待后台重试。

8. **索引与 Web。** 仅对实际成功写入的快照调度索引，不调度被跳过/替换/失败的内容；保留手动约 1.2 秒、自动约 5 秒的既有延迟与索引 PendingLatest。Web 保留文件句柄和下载回退，回执区分写入成功与触发下载，不把下载点击描述为已确认原文件落盘；不扩大 Web 能力或引入 SQLite。

### 验收标准

以下已勾选项指实际自动化检查；原生表面单列最后一项，仍为 NOT TESTED。

- [x] 用可控 deferred writer 和 fake timer 通过生产保存入口复现“旧写入未结束时发生新保存”；改动前证明缺少同路径串行契约，改动后每条路径最大并发为 1。
- [x] A 写入阻塞，B/C 到达：实际只写 A、C；A 未结束前 C 不启动；不同路径可独立推进。
- [x] 自动与手动混用、连续 Ctrl+S、两个 Hook 实例调度、桌面大小写/分隔符路径变体仍共用一条队列。
- [x] A 完成时 content 为 B：savedContent=A、modified=true，正文 B 不变；最新版本写入成功后才清脏。编辑后撤回到相同内容不会让过时待写版本覆盖当前正文。
- [x] 预览勾选保存中继续编辑不会被旧回调覆盖；预览块提交继续经既有正文入口与自动保存。
- [x] A 失败后出现 C：只重试最新 C；永久失败有界停止、提示、保留脏状态，随后手动重试可恢复；所有等待者均正确结算。
- [x] Tab 快速切换、关闭/重开、原路径改变、自动保存关闭和 Hook 卸载不造成跨文档确认、迟到覆盖或同路径锁提前释放。
- [x] 另存为取消、重复触发和写入期间继续编辑均安全；新正文与草稿不丢失，只有成功后绑定有效路径。
- [x] 仅成功写入快照触发索引；重复完成不倒退索引；浏览器保存/下载回退保持现有行为与真实状态语义。
- [x] 最小相关测试、类型检查、Lint、边界检查及 Core Smoke 通过；无无关 diff。
- [ ] 用匿名临时 .md 在原生 Tauri 验证持续编辑与手动保存交错、预览勾选后编辑、失败后恢复、另存为后继续编辑；停止后读取临时磁盘文件，确认等于当前正文。自动测试不能代替此项。


### 检查命令与证据

本轮为规划，不执行以下功能检查。实现阶段先新增确定性保存测试，再执行；新测试文件名按实际落地更新本节，不把规划命令记为 PASS。

```powershell
# 新增保存协调器及入口测试后，先运行这些实际文件（--maxWorkers=1）
npx vitest run tests/editor/documentSave.test.tsx tests/web/browserFileSystem.test.ts tests/editor/documentModelContract.test.ts tests/editor/previewTabSwitchRegression.test.tsx --maxWorkers=1
npm run test:store-boundaries
npm run test:file-access
npm run typecheck
npm run lint
npm run test:smoke
git diff --check
```

- 命令按依赖顺序执行，失败先处理首个根因；后续只重跑受影响检查。
- 若保存调用修改触及资源生命周期，追加现有 EditorArea.resourceLifecycle/modeResourceLeak 定向测试；不批量读取所有 tests。
- 新增模块不引入重型依赖；若实际改变加载边界，再执行相关 Desktop/Web build 与 bundle gate。Rust 未改不运行 Rust 编译/测试；不跑全量测试或发布门禁。
- 原生验收必须核实正在运行的进程、工作区和 HEAD；使用新鲜对应产物及匿名临时文件。无原生通道时记 NOT TESTED，阶段保持进行中。
- 风险 HIGH → 验收建议 L3 强模型。用户明确调用后才启动模型 Review；复用已有 Machine Gate，最多一次 Fix → Re-review。
- 建议调用词：`使用 ai-code-review Skill 执行本次模型 Review；以统一保存任务 diff 为起点，检查 Blast Radius 和 Regression Surface，重点核实串行写入、最新重试、保存确认与另存为，不扫描无关代码。`

### 禁止事项与避坑

- 不只加写前/写后 content 判断：这不能建立写入顺序；不把 Hook 局部锁误当应用级锁。
- 不只修自动保存而保留手动、另存为、预览勾选旁路；不在旧调用方继续执行陈旧完成副作用。
- 不将“入队成功”“旧版本写入成功”或“下载已触发”当作当前正文已落盘。
- 不用执行序号替代内容相等与路径/Tab 身份校验；不持久化队列或新增文档 schema。
- 不取消或清空执行中写入来释放锁；不无限重试，不用清空数据/重置配置处理错误。
- 不新建第二套索引队列，不改变 RAG 算法、文件权限或 Web 能力。
- 不清理未跟踪目录、旧基线产物或无关死代码；不扩大到原生原子写、跨进程保存或文件重命名事务。
- 用户已授权本轮实施；不在阶段 1 验收未完成时提前实施阶段 2。

## 阶段 2–5 详细任务｜API 密钥与 XSS 安全加固

### 已核实基线与待核实边界

- `src/services/ai/providers/openaiCompatible.ts` 仍用 `config.apiKey` 拼装 Authorization；`src/services/externalHttp.ts` 把请求头通过 IPC 交给 Rust。不能只迁移这个 Provider 而遗漏其他协议、Embedding、模型列表和联网搜索。
- `src/services/secureStorage.ts` 与 `settingsStore.hydrateSecrets` 是现有密钥/前端恢复入口；开发总指南说明 Windows 存储已由 Rust 使用 DPAPI 保护。实施阶段必须核实当前 Rust 存储命令、配置预设和旧数据迁移；本轮未检查全部读取与导出入口，不声称已发现全部明文副本。
- `src-tauri/src/api_http.rs` 已有请求体 2 MiB、响应体 16 MiB、超时 120 秒和并发 8 的限制。外部 HTTP 契约已要求 Origin 授权、DNS/IP、请求头和重定向校验；先复用并验证，不能把这些写成全新待建能力，也不默认降低现有上限。
- `src-tauri/tauri.conf.json` 的 CSP 当前含 `script-src 'unsafe-inline'` 及较宽 connect-src；本轮未复现 XSS，未核实每个渲染入口清洗或现有权限覆盖情况，不能把允许项直接当作已可利用漏洞。
- `src/web/WebSettingsPage.tsx` 已有 Key 存储选择和明文保存风险弹窗，缺少覆盖所有模式的常驻运行期提示。当前 `external-http.md` 与 `web-deploy.md` 允许 Web 对话/搜索配置；根 AGENTS.md 部分 Web 描述更严格，实施遇到实际权限冲突时先澄清，不借安全任务启用或禁用既有功能。
- 密钥隔离降低长期泄露风险，不阻止 XSS 借合法代理发请求；CSP、清洗、IPC 最小权限和代理操作限制共同构成防护。首次输入 Key 短暂经过前端，Web 解锁后的 Key 也必须在页面使用，不能宣传为“XSS 无法获取”。

### 各阶段开始前的最小读取

- 共用：根目录及目标目录规则、`docs/AI_REVIEW_PROJECT.md`、全局 `guides/engineering-execution.md` 与 `guides/delivery.md`；仅查询当前阶段相关知识图，过期或不足时精确搜索，不重建图或 embedding。
- 阶段 2：`docs/agent-contracts/ui.md`、`external-http.md`、`docs/web-deploy.md`；核实 Web Key 配置区与现有提示。
- 阶段 3：总指南第 10 节、设置/AI 对应 `state-ownership.md`、`external-http.md`、`desktop-services.md`、全局 `guides/api-coordination.md`、`guides/compatibility.md`；涉及文件或备份边界时补读 file-access/database 契约。
- 阶段 4：`external-http.md`、`desktop-services.md`、API 协调指南；核实 Rust 代理与阶段 3 密钥绑定契约，修改前给出简短调用链和 Blast Radius。
- 阶段 5：`markdown-editor.md`、`file-access.md`、`external-http.md`、`desktop-services.md`、`docs/web-deploy.md`；触及预览状态补读对应 ownership。修改 MarkdownPreview、启动或加载边界时遵守项目同机基线与交付限制，不以静态阅读宣称性能无影响。

### 阶段 2｜提示先行

- 允许修改：`src/web/WebSettingsPage.tsx` 的 Key 提示和必要样式、最少直接相关验证、本文件。
- 实施：在聊天/搜索 Key 配置可见区域展示常驻、主题可读的提示；三种模式均可见，不依赖用户先选择明文保存。保留已有明文保存弹窗和按钮语义，不新增确认步骤。
- 建议文案：`浏览器运行期间，恶意脚本可能读取或使用 API Key；密码加密保存不能消除这一风险。建议使用专用、低额度、可随时撤销的 Key，并在供应商后台设置消费上限。`
- 验收：内存/明文/加密、锁定/解锁、明暗主题与窄屏下提示可读；保存、解锁、清除及原有确认行为不变；不把加密模式写成免疫 XSS。不改默认存储、格式、权限或请求行为。
- 检查：改动文件 ESLint、`git diff --check`；若改 JSX/类型逻辑执行 `npm run typecheck`。在真实 Web 页面核实布局及原有操作；未执行记 NOT TESTED，不为纯文案新增镜像测试。

### 阶段 3｜Rust 内部密钥使用与兼容迁移

- 允许修改：`secureStorage.ts`、`settingsStore.ts` 中必要密钥元数据/恢复边界、桌面 Key 配置与预设入口、实际持有凭据的 Provider/Embedding/搜索适配、`externalHttp.ts`、`src-tauri/src/api_http.rs`、实际安全存储命令与注册/权限、直接相关契约与测试、本文件。仅改这些职责，不重构 Agent 或业务 DB。
- 实施顺序：核实三类 Key、预设身份与旧迁移 → 定义窄 IPC 请求及 Key/Origin 绑定 → Rust 内部读取与鉴权 → 配置 UI/调用入口接入 → 删除前端明文恢复和可读密钥命令 → 兼容与原生验收。
- 复用已有 DPAPI 存储，不把“从前端移走”误解为重新迁移到另一种库。前端保留已配置/缺失状态与写入、替换、删除能力；编辑时留空代表不变，删除须显式操作。保存后清除本次输入的临时明文，不提供返回完整 Key 的查看/复制接口。
- IPC 传配置身份、受限操作、模型/消息等业务参数，Rust 决定鉴权头和目标。调用方不能通过传任意 URL、headers 或 credential ID 把另一供应商 Key 发往其他 Origin；无鉴权更新检查与本地免 Key 请求也要保持明确边界。
- 旧 Key 在迁移确认成功前保留；失败可重试并提示，不能假装已保存、清空旧配置或静默改回前端明文。核实旧预设、备份/导出是否含 Key，并采取兼容读取、受控迁移和脱敏；不擅自扩大为全量备份重构。
- 验收：冷启动、保存/替换/删除、切换预设、迁移失败与重试可用；聊天、模型列表、Embedding、联网搜索及多协议鉴权正确；自定义 Origin、本地模型和 SSE/取消保持。前端 Store、持久化、普通 IPC 响应及日志/错误/导出均不含已保存明文 Key；任意 Key 读取命令拒绝调用，伪造目标不能带走凭据。
- 检查：匿名旧格式 Fixture 的最小迁移/存储测试、实际 Rust 密钥及代理定向测试、`npm run test:ai-http`、`npm run test:privacy-logs`、`npm run typecheck`、改动文件 ESLint、`npm run test:smoke`、`git diff --check`。仅构建验收所需新鲜原生产物；真实密钥不进入 Fixture/日志，以本地匿名服务捕获合成鉴权验证请求。
- 交付边界：本阶段证明减少明文暴露；未完成阶段 4 时不得声称代理滥用已解决。安全存储系统失败不能使用明文回退；跨平台支持以现有产品范围为准，缺失能力明确报错，不新建未要求的跨平台框架。

### 阶段 4｜操作白名单与代理滥用限制

- 允许修改：`api_http.rs`、阶段 3 的窄请求类型/调用适配、必要 Origin/凭据绑定配置与撤销 UI、直接相关权限、契约和测试、本文件；不新增通用网络代理或修改 Agent 工具权限。
- Rust 强制校验供应商/已授权自定义服务、方法、精确接口和操作的组合；覆盖 Chat Completions、多协议聊天、Embedding、模型列表、搜索、更新的真实需要。禁止任意路径、路径编码绕过、任意鉴权头及跨 Origin 凭据复用；配置身份和授权目标不能只由前端自行宣称。
- 自定义 API 与本地模型沿用明确 Origin 授权，再绑定允许操作与所需端点；切换目标不得默默沿用旧 Key 信任。拒绝危险地址/重定向等现有防护保持，不用固定内置域名名单破坏已支持的自定义服务。
- 在现有并发、大小、超时上增加按凭据/配置的速率限制，并有应用级累计请求及输出/用量边界，防止切换配置绕过。先记录聊天、Agent 多轮、Embedding 批次和搜索的正常需求，再确定具体阈值与窗口；实现阶段写入实际数值、达到上限的拒绝语义及必要设置，不提前猜测供应商价格或一刀切压低大小上限。
- 区分请求次数、可校验 token/输出预算与真实费用；每次重试消耗对应额度。若提供跨重启的日累计限制，最小持久化必须兼容旧配置并核实重启不能清零绕过；会话限额明确标为会话限额。供应商消费硬上限由用户在供应商后台设置，本地统计仅为辅助，不包装为账单保证。
- 验收：合法内置/自定义/本地请求可用；伪造操作、方法、编码路径、跨配置 Key、未授权 Origin 均被 Rust 拒绝；突发、并发、累计限额、取消/超时与失败后的资源释放正确。仅允许读取已配置状态不应泄露 Key。限额不能使正常 Agent/索引产生无限重试或静默失败。
- 检查：最小 Rust 代理/限额测试和合成本地 HTTP 服务验收，`npm run test:ai-http`、`npm run test:privacy-logs`、`npm run typecheck`、改动文件 ESLint、`npm run test:smoke`、`git diff --check`；数据/接口变化更新对应契约。不跑全量 Rust 或发布门禁。

### 阶段 5｜防注入与最小权限

- 允许修改：`src-tauri/tauri.conf.json`、实际 capabilities/command 权限、Web CSP 配置入口（先核实部署可用方式）、当前 Markdown/HTML、SVG、Mermaid、图表等不可信内容的实际渲染与清洗模块、直接相关契约/测试、本文件。只改有证据的入口，不另起第二套全局渲染器。
- 先分别核实原始 HTML、危险 URL/事件属性、SVG、Mermaid/图表与其预览/全屏 surface，复用清洗能力并验证清洗之后未重新拼入不可信 HTML。React 转义或单一 Markdown sanitizer 不能自动证明其他入口安全。
- 查明内联脚本来源后移除不必要的 `script-src 'unsafe-inline'`，优先使用静态脚本；有真实必要项才采用受控 nonce/hash。分别收紧 connect-src、资源源及其他有效指令；不把 `style-src 'unsafe-inline'` 当成脚本同等风险机械删除，不用放宽其他指令补偿破坏。
- Desktop 与 Web 使用各自实际 CSP，验证开发/Release 及真实 Web 部署方式；保留图片、公式、图表、资源协议和现有本地模型需求，发现必要兼容例外时记录精确来源与理由，不恢复宽泛允许。
- 核实窗口/远程内容/iframe 的 IPC 与 command 权限，移除确实不需要的能力；自定义 Rust command 必须核实实际 ACL 注册和后端参数校验，不能只缩 capabilities 文件就宣称已隔离。密钥、Authorization、文档正文和原始服务错误不得进入日志或提示。
- 验收：匿名攻击 Fixture 的 script、事件属性、危险 URL、SVG 与图表路径不能执行或获取 IPC 能力；安全 Markdown、链接、图片、公式、图表、全屏预览仍正常。桌面 Release 和 Web 真实页面分别验收 CSP 生效、正常网络与权限拒绝；未测表面标 NOT TESTED，不宣称完全消除 XSS。
- 检查：实际受影响的最小渲染/CSP/权限测试、`npm run test:privacy-logs`、`npm run typecheck`、改动文件 ESLint、`npm run test:smoke`、`git diff --check`；改构建/CSP时执行 `npm run build:desktop` 与 `npm run build` 的对应 bundle gate，涉及 Rust ACL 时仅做必要定向验证。

### 安全专项共同交付边界

- 本轮只规划；以上功能检查、安全攻击 Fixture、迁移、限额、桌面/Web 原生验收均 NOT TESTED。未来阶段按实际执行记录 PASS/FAIL/NOT TESTED；关键验收缺失时保持进行中。
- HIGH 阶段建议 L3 验收模型；用户明确调用 `ai-code-review` 后才做模型 Review，复用已有门禁，最多一次 Fix → Re-review。提示词：`使用 ai-code-review Skill 审查当前安全阶段 diff，重点检查密钥不返回前端、目标绑定、旧数据兼容、Rust 操作/限额及实际 XSS/IPC 边界；仅检查有调用链证据的影响范围。`
- 不读取真实用户密钥做自动测试，不在日志、错误、截图或测试结果中显示 Key；不清空旧数据、不静默明文回退、不新增远程中转服务、不改变 Web 存储模式与既有业务权限。远程部署仍需项目安全门禁与二次确认。

## 阶段 6 详细任务｜Agent 按需上下文超限恢复

### 目标与已确认决策

- 用户反馈：此前尝试默认上下文窗口预算，经常限制日常请求，因此已撤回；撤回后没有观察到明显不可用状态。这是用户使用反馈，不是本轮测试结论。
- 采用“正常直接发送，明确超限后压缩”的方案，避免未知模型窗口的保守猜测影响日常请求；不新增预算设置，不让用户调整上下文窗口。
- 保留现有单工具结果限额、去重、权限、工具调用次数和 deadline；正常路径不增加摘要模型请求，也不新增总预算估算或裁剪。
- 超限恢复解决请求不可发送的问题，不能保证未超限的复杂任务回答质量。只有后续出现明确质量退化证据，再评估执行轨迹整理或任务摘要；本阶段不实现模型摘要。

### 已核实入口与下一步核实

- `src/services/agent/executor.ts`：构建 system、历史、当前上下文与问题；工具循环和无候选工具回复已有上下文超限后的单次 `dropOldestCompleteTurns` 重试。工具结果追加到消息后继续请求，压缩不能重启工具执行循环。
- `src/services/ai/contextBudget.ts`：已有正文 token 估算、基于错误文本的超限识别和删除最旧完整问答轮次；目前按最后一条 user 判断当前轮次。
- Agent 工具反馈也可能使用 user 角色，不能仅靠 role 判断当前真实问题和历史轮次；先明确当前请求边界，保护本轮 query、selection/file tag 授权、修改确认及最终回答指令。
- `src/hooks/useAiChat.ts`：接收 Agent finalMessages 后通过 `src/services/aiChatFlow.ts` 的 `streamFinalAnswer` 生成最终回答；该函数也已有单次删除最旧轮次的超限兜底。不能只改工具循环而遗漏最终回答。
- 图查询能定位 runAgent，但图落后 HEAD；实施时以当前源码为准，用精确符号补查，不重建 embedding。
- 下一步只核实上述入口的消息表示、流式重试状态、引用映射和可用 Provider 错误信息；本轮未验证错误分类准确性或真实超限恢复效果。

### 开始前读取、范围与影响

- 读取根目录及目标目录规则、`docs/AI_REVIEW_PROJECT.md`、`docs/GUANMO_DEVELOPMENT_GUIDE.md` 中 Agent 请求链路、`docs/architecture/state-ownership.md` 中 AI/聊天相关边界、`docs/agent-contracts/ai-selection.md`、`external-http.md`；压缩来源信息时补读 `rag-memory.md`。
- 允许修改：`src/services/agent/executor.ts`、`src/services/ai/contextBudget.ts`、`src/services/aiChatFlow.ts`、`src/services/aiChatMessages.ts`、`src/hooks/useAiChat.ts` 的必要消息/重试接入、最少必要 Agent 请求类型、直接相关测试及本文件。
- 不默认修改工具实现、路由、Store、Rust、DB、持久化消息、设置、依赖或 CI；确有范围外必要改动先说明。
- Blast Radius：Agent 普通回复、工具循环、补调后的请求、最终回答 → 模型请求重试；间接影响流式展示、取消/deadline、来源编号和编辑确认。压缩只改变发往模型的请求副本，原始聊天记录、工具步骤和授权真相保持不变。

### 实施方案与禁止事项

1. 先用模拟 Provider 在实际入口复现首次明确超限、普通成功和其他错误；优先复用现有 helper，统一最少必要恢复策略，不预建通用预算框架。
2. 仅明确的上下文超限触发压缩；优先使用现有可用结构化错误信息，保留必要的供应商文本兼容。网络、限流、鉴权、服务异常和用户取消不得触发压缩；不放宽错误匹配去猜未知错误。
3. 一次压缩可移除多轮最旧完整历史，并压缩重复或被替代的旧工具结果，避免仍只删一轮。未知模型上限时不倒推出默认窗口，也不声称能保证一次压缩成功。具体压缩力度依据实际消息边界选择可解释规则，不添加用户配置。
4. 必须保留安全规则、当前问题与约束、当前授权目标、待确认操作、必要证据和稳定来源编号。工具调用/返回按现有协议成组处理；结构化结果按完整条目压缩，不能截断 JSON、破坏调用配对、伪造工具成功或将工具材料提升为可信指令。被裁掉的材料不能被描述为模型已经看到；引用映射不得悬空或重编号。
5. 每次模型请求最多一次压缩重试，只有消息确实减少且尚未取消/超时才重试；后续工具循环复用压缩后的本轮有效请求上下文，不能每轮恢复已剔除材料。不得重启整个 Agent、重复执行读写工具、重置调用计数或延长 deadline。
6. 流式与非流式、无候选工具回复及 Agent 最终回答使用一致边界。若错误发生在已有部分流式输出之后，先核实可安全重试的条件与展示复位，不能重复拼接回答或清除非本轮内容。
7. 无可安全压缩内容或重试仍超限时，明确提示当前材料过大并建议缩小范围，保留原始会话和已完成工具结果。沿用现有失败/未完成语义，不伪装成功、不静默吞错、不无限重试。
8. 不恢复已撤回的固定总预算，不自动降小单工具限额，不新增模型摘要调用或全局设置，不通过清空聊天数据解决问题；日志不记录正文、密钥、完整错误或用户路径。

### 验收标准与检查

- [ ] 日常成功请求与修改前发送内容一致，请求次数不增加，无主动总量裁剪、摘要或预算配置。
- [ ] 长历史及累计工具结果场景：首次明确超限后有效减少请求，最多重试一次；保护当前真实问题与授权，后续请求不重新塞回被剔除材料。
- [ ] 普通错误、取消、deadline 均不触发超限恢复；再次超限或无法压缩时有明确终止结果。
- [ ] Agent 工具循环、无候选工具回复及最终回答均覆盖流式/非流式适用分支；部分流式失败不重复显示或污染其他请求。
- [ ] 超限重试不重复任何工具副作用、不重置执行预算；来源编号、必要证据和待确认编辑保持有效，不改原始聊天记录或持久化格式。
- [ ] 用 mock Provider 的实际生产入口回归上述不变量；类型检查、改动文件 ESLint、定向 Smoke 和 diff 检查通过。
- [ ] 原生 Tauri 验收日常请求与可控的明确超限恢复；核实运行产物、工作区与 HEAD。缺少真实超限条件时此项记 NOT TESTED，不把 mock 结果当原生验收。

实施时先核实并选择实际受影响的测试文件，例如 `tests/agent/agentContextContinuation.test.ts`、`aiChatFlowContext.test.ts`；工具计数和流式前置条件仅在受影响时补跑 `agentExecutionBudget.test.ts`、`agentStreamPrerequisite.test.ts`。新增测试按实际文件名更新，不批量读取测试目录。

```powershell
# 先运行实际受影响的测试文件及最少新增回归，使用 --maxWorkers=1
npx vitest run tests/agent/agentContextContinuation.test.ts tests/agent/aiChatFlowContext.test.ts --maxWorkers=1
npm run typecheck
# 对实际修改文件执行 npx eslint，不默认运行全仓检查
git diff --check
```

- 按实际风险执行项目要求的最小定向 Smoke；未改传输层不默认运行 test:ai-http，未改 Rust 不编译 Rust，不执行全量测试、构建或发布门禁。
- 初步 MEDIUM → L2 验收模型；用户明确要求模型 Review 后，复用已有 Machine Gate。建议提示词：`使用 ai-code-review Skill 审查 Agent 超限恢复阶段 diff，重点检查当前轮次保护、错误分类、重试副作用、流式取消和引用完整性，不扫描无关代码。`
- 当前验证：仅源码核实；本阶段功能测试、模型实测与原生验收均 NOT TESTED，业务代码未修改。

## 明确下一步

阶段 1 代码与 Machine Gate 已完成，当前仍为进行中；用户已明确暂缓验收，暂不运行后续构建/原生验收。恢复验收后按以下步骤执行，不要重新实现队列或提前实施阶段 2。

1. 核实 `git status --short`、本文件和当前 HEAD（本轮为 `0c6496d67695b43ac0d9afb1d608b89116ea66cf`）；全部业务 diff 属于本轮已授权任务，原先计划文件修改和未跟踪目录保留。
2. 确认系统内存/提交额度足够后，只重试必需的原生构建；不得关闭用户程序、删缓存、改变系统页面文件或修改构建门禁来强行通过。前端产物已通过 Desktop gate，源码/配置不变时可复用 `dist/`，以 `$env:CARGO_BUILD_JOBS='1'; npx tauri build --no-bundle --config 'D:\temp\guanmo-save-build-override.json'` 跳过重复前端构建（临时 JSON 仅 `{ "build": { "beforeBuildCommand": "" } }`）。缺失临时文件时重新在临时目录创建；源代码变化后先重建前端。
3. 新鲜 EXE 成功后记录路径、时间、工作区/HEAD；独立 APPDATA/LOCALAPPDATA/WebView2 profile 和匿名临时 .md 验证自动与 Ctrl+S 混用、预览勾选后新编辑、写入失败后恢复、另存为继续编辑与取消。读取磁盘与最新正文比较，核实脏标志与目标绑定。不要以 mock、旧 EXE 或下载点击代替真实落盘。
4. `D:\temp\guanmo-save-native.mjs` 是本轮准备但**尚未执行/验证**的独立 CDP 测试草稿，只包含持续编辑/手动保存的初始探针；先检查它的启动/模式/选择器条件，补齐其余原生流程，不能把该脚本记为 PASS。它复用项目 cold-start CDP/隔离环境模式，并保留临时文件，未修改产品或原生 command。
5. 本轮只改保存调用，不改模式/资源生命周期，不宣称性能收益。编辑/预览各 3 次旧产物同机基线已记录（下方）；原生构建失败，修改后对照 NOT TESTED。环境恢复后再完成对照；若转为性能优化则必须按 AGENTS 的至少 10 次/模式执行，不用本轮 3 次样本声称优化效果。
6. 原生项通过后勾选最后一项、将阶段 1 标为已完成并切换阶段 2。阶段 2 涉及 Web 设置与密钥 UI，建议新窗口重新建立范围；用户已有逐阶段实施授权，不要求再次确认。阶段 2–6 的原规划保持未开始。

验收建议：HIGH → L3 强模型；仅用户明确调用才做模型 Review。可用提示词：`使用 ai-code-review Skill 审查阶段 1 的保存链路 diff，复用 75 项回归、Core Smoke 与边界检查，重点检查串行写入、失败预算、身份保护、保存确认和另存为；原生未验收保持 NOT TESTED。`

## 阶段历史

### 2026-10-05｜评估与计划覆写

- 状态：计划已编写；阶段 1 未开始。
- 完成内容：核实当前入口与状态边界；选择按路径共享队列、最新待写合并、身份保护、正文不回写和有界重试。
- 实际修改：仅 AI_IMPLEMENTATION_PLAN.md；业务代码、依赖、配置均未修改，既有未跟踪内容保留。
- 验证结果：git diff --check PASS；功能测试、构建与原生验收 NOT TESTED。
- 遗留问题：尚未实施；原生磁盘乱序未实测，权限失败/另存为/浏览器回退需实施时定向验证。

### 2026-10-05｜追加 Agent 超限恢复计划

- 状态：阶段 2 未开始；当前阶段仍为阶段 1。
- 完成内容：记录已撤回固定窗口方案的原因，选择明确超限后确定性压缩与单次重试；补齐最终回答、当前轮次保护、引用及副作用验收边界。
- 实际修改：仅本文件的标题、状态和新增阶段内容；保留既有保存队列计划与未跟踪内容，未提交。
- 验证结果：`git diff --check` PASS；功能测试、构建、模型实测与原生验收 NOT TESTED。
- 遗留问题：实施时核实 Provider 超限识别、工具反馈与当前问题边界、压缩力度和部分流式输出恢复；模型摘要留待明确证据与后续授权。

### 2026-10-06｜追加 API 安全专项与重排开发顺序

- 状态：阶段 1 保持未开始；新增阶段 2–5 均未开始；原 Agent 阶段 2 改为阶段 6，原方案与历史保留。
- 完成内容：按保存可靠性 → Web 提示 → Rust 密钥内部使用 → 代理操作/限额 → CSP/清洗/权限 → Agent 超限恢复排序；补齐阶段依赖、允许范围、兼容迁移、禁止事项、自动和真实表面验收。
- 决策依据：桌面已有 DPAPI 与代理资源限制，优先复用；不再长期返回 Key，但仍需限制代理滥用；Web 加密只能保护持久化密文，解锁后不免疫 XSS。未确认可利用漏洞，不以静态观察宣称攻击已复现。
- 实际修改：仅本文件，保留原有未提交内容与未跟踪目录；未修改业务代码、未提交。
- 验证结果：`git diff --check` PASS；新增阶段功能测试、构建、安全攻击验证与桌面/Web 验收 NOT TESTED。
- 下一步：等待用户指定执行阶段；按本文件对应入口核实，阶段 3 需核实预设/备份与旧格式，阶段 4 确定实际限额，阶段 5 核实每个渲染和部署 CSP 入口，不在本轮预设实现细节。

### 2026-10-07｜阶段 1 实施与机器验收

- 状态：进行中；功能实现与机器门禁已完成，原生构建环境阻塞，阶段 2–6 未开始。
- 当前实现：`documentSave.ts` 持有应用级按文件身份队列，每路径一个执行中/一个 PendingLatest；替代请求等待替代版本真实回执，失效请求取消；自动开启时本轮追上最新正文，关闭撤销自动待写；失败预算按路径共享，3 次停止，手动可开启新一轮。
- 身份与正文：运行时 Tab 身份在关闭/路径改变时失效，旧写入仍持锁至结束；仅 Store action 更新成功基线。预览不再把旧快照写回正文；saveTabAs 保留当前正文，选择器结束读最新内容，写成功后绑定；下载保留脏状态且不索引、不自动重试下载。
- 入口与兼容：自动 Hook、AppLayout 的 Ctrl+S、CodeMirror onSave、预览勾选、CommandPalette、Tab/文件菜单全部接入；文件树另存为仍新开副本，不把源 Tab 改绑。非文档 AI 导出保留原有底层 saveFileAs，不纳入文档业务入口。浏览器选择目标不写入，isSameEntry 复用现有句柄 URI；新增 WeakMap 只保存原始 URI，避免内部规范化缓存 key 损坏 `webfs://`，不持久化句柄/队列。
- 修改文件（全部未提交）：新增 `src/services/documentSave.ts`、`tests/editor/documentSave.test.tsx`；修改 `useFileOperations.ts`、`EditorArea.tsx`、`CommandPalette.tsx`、`fileSystem.ts`、`browserFileSystem.ts`、`fileEntryActions.ts`、`editorStore.ts`、`tests/web/browserFileSystem.test.ts` 和本文件。必要扩展已向用户说明；最终 `git diff --check` PASS。Rust、配置、依赖、权限和 RAG 算法未修改。
- 修改前证据：生产 useFileOperations 入口 deferred writer 测试 FAIL，阻塞 A 时已经发出 A/B/C；修复后只发 A/C，最大并发 1。仅证明前端顺序缺失；原生磁盘回退未复现。
- 自审：以当前 diff 与保存入口调用链核实，无已确认的 P0/P1 阻断缺陷；未执行独立模型 Review。残余风险为新鲜原生产物与实际选择器/落盘/失败恢复均未验收。
- PASS：`npx vitest run tests/editor/documentSave.test.tsx tests/web/browserFileSystem.test.ts tests/editor/documentModelContract.test.ts tests/editor/previewTabSwitchRegression.test.tsx --maxWorkers=1`，4 文件 75 项；`npm run test:store-boundaries`、`npm run test:file-access`、`npm run typecheck`、`npm run lint`（0 error/41 既有 warning）、最终改动文件 ESLint；`npm run test:smoke`，2 文件 8 项。Desktop 前端构建和 bundle gate PASS：入口 1,151,078 bytes，总 JS 6,902,751 bytes，101 chunks。
- 检查中的问题：预览测试首次与 tsc/Lint 并行执行出现 30 项失败，单项及完整串行重跑 PASS；不为此改生产预览逻辑或测试断言。浏览器新增测试发现重复目标返回规范化 `webfs:/`，已通过原始 URI 映射修复，两个针对性用例 PASS。后续重型 Node/Rust 检查保持串行。
- FAIL/环境：`npm run tauri -- build --no-bundle` 的 Rust 编译内存分配失败；`CARGO_BUILD_JOBS=1` 复用前端再试仍失败并使 PowerShell 报 Out of memory。未重试循环、未清理缓存、未改配置门禁。原生落盘、原生选择器、失败恢复和新 EXE 启动对照均 NOT TESTED；不可用旧产物宣称通过。
- 旧产物基线：`node scripts/measure-cold-start.mjs --runs=3 --surface=edit --keep` 与 preview 对应命令 PASS；EXE 2026-10-05 18:03:04、25,887,232 bytes。编辑 launchToSurface 900/1091/928 ms（中位928）、frontendToSurface 324/389/329 ms（中位329）、launchToAppReady 789/949/852 ms（中位852）；预览对应 893/1071/893 ms（中位893）、301/387/316 ms（中位316）、831/932/804 ms（中位831）。不是性能收益结论。
- 临时证据：`D:\temp\guanmo-save-final-tests.txt`、`guanmo-save-smoke.txt`、`guanmo-save-lint.txt`、`guanmo-save-file-access.txt`、`guanmo-save-native-build.txt`、`guanmo-save-native-retry.txt`、`guanmo-save-baseline-preview.txt`；测试基线目录均保留，不清理。`D:\temp\guanmo-save-native.mjs` 未执行，接续者先核实后使用。
- 交接约束：全局 guides 路径本机不存在；使用实际 AGENTS、计划、现行契约与 AI_REVIEW_PROJECT。知识图落后 HEAD，不重建。保留 `.workbuddy/`、`src-tauri/target-reading-position-baseline/`；不提交、推送、tag、Release 或 PR。

### 2026-10-07｜本地提交授权与验收暂缓

- 用户要求：提交本次修改，验收暂缓；只做本地提交，不执行远程操作。
- 范围：8 个业务文件、2 个测试文件及本计划；保留并排除 `.workbuddy/` 与 `src-tauri/target-reading-position-baseline/`。
- 阶段 1 保持进行中，原生验收与新产物启动对照维持 NOT TESTED；不因本地提交而标记阶段完成，不重跑已通过的机器检查或失败的构建。
- 恢复点：用户恢复验收后先核实系统资源和新鲜产物，再按“明确下一步”完成原生验证；阶段 2–6 保持未开始。
