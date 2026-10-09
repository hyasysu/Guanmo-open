# 观墨保存可靠性、API 安全加固、Agent 超限恢复与搜索边界修复｜阶段任务

> 本文件是本任务唯一状态来源。使用 staged-task-handoff 恢复任务，以当前源码和实际验证为准。2026-10-05 按用户授权覆写旧架构治理计划；旧计划的完成记录和未验收事项不属于本任务，也不据此宣称已验收。

## 当前状态

- 当前阶段：阶段 7｜搜索会话失效、实例绑定与导航一致性。
- 阶段状态：进行中；搜索实现与机器门禁完成；新鲜 Tauri Release/原生验收及新产物启动对照 NOT TESTED。
- 当前授权：2026-10-10 用户要求提交阶段7并详细描述；仅本地提交阶段7十文件，不执行远程操作，不实施阶段8/9；原生验收继续暂缓。
- 上次执行结果：保留搜索/替换输入；显式绑定真实 EditorView 和已提交预览模型；文件/模式/正文/实例/双栏变化废弃旧坐标，自动刷新不定位；替换重算有效匹配，精确清理搜索层与搜索补定位。
- 验证结果：修改前正式7项FAIL并复现短替换Selection越界；定向累计覆盖73项（5文件72 PASS/2既有skip；新增空词后受影响搜索3文件24/24）；typecheck、ESLint（0 error/8既有warning）、Smoke8/8、git diff --check PASS，详见阶段7历史。
- 本阶段剩余：沿用原生暂缓，在匹配工作区/HEAD的新鲜Tauri Release完成匿名文档搜索路径、与旧安装版差异及启动对照；不把mock宿主/静态分析写成原生PASS。
- 本阶段允许修改：5个搜索链路业务文件、3个直接回归、搜索ownership及本计划；保存、Store/持久化、DB、Rust、权限、AI/RAG、依赖与启动加载策略不改。
- 待验收：阶段1/3/4/5/6/7保持进行中；阶段2已完成；阶段8/9未实施，既有暂缓项保留。
- 技术决策：EditorView.doc对象身份拒绝防抖前的旧坐标；Compartment/ViewPlugin可解除绑定，microtask检查实际绑定存活后刷新。预览在旧索引清理后通知，未就绪不扫源码；自动刷新显示0/N，首次导航按当前光标/视口方向选择。
- 工作区基线：提交前HEAD=7e394cf1d599568f01b3b6196369c021b2f25f99；阶段7十文件纳入本地提交，实际提交号以git log核实。阶段8/9追加章节保持未提交；两个既有未跟踪目录原样保留。
- 阻塞问题：无实施阻塞；原生/新产物启动检查暂缓，不能将阶段7标记已完成。
- 下一阶段：阶段8｜完整来源与按文档区块定位；需用户明确指定，详见文件末尾追加计划。
- 会话建议：建议新开窗口；阶段8转入阅读成果来源/区块定位新范围，阶段7实现与待验收完整写入本文件。

## 项目目标与评估结论

本计划包含保存可靠性、API 密钥与 XSS 安全加固、Agent 超限恢复、搜索边界修复四项；以下保存成功标准仅适用于阶段 1，安全专项标准见阶段 2–5，搜索标准见阶段 7。阶段2已完成，阶段3/4实现与非桌面检查完成但原生验收暂缓；阶段5实现与本地Web验收通过，原生/线上验收仍暂缺；阶段6实现与机器检查完成但原生验收暂缓，阶段7实现与机器检查完成、原生暂缓。源码核实不等于安全验收或漏洞已复现。

值得修改。写前快照校验只能淘汰尚未启动的旧任务，无法给已经发出的异步保存建立顺序；应由应用级、按文件身份分组的协调器串行写入，并统一处理保存确认、失败重试和索引调度。

成功标准：同一文件最多一个执行中的写入和一个可替换的待写快照；不同文件可独立保存；停止编辑且写入成功后，磁盘为最新有效保存快照。迟到结果不能覆盖当前正文，只有当前正文等于最后成功写入内容时才显示为已保存。

### 规划时已核实的链路（阶段 1 实施前基线）

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

以上为规划时基线；阶段 1 实施结果与本任务验证证据见阶段历史，不复用旧架构任务的测试记录。

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
| 7 | 搜索会话失效、实例绑定与导航一致性 | 2026-10-08 新增；修复文件/模式切换、内容变化、替换及关闭边界，无安全专项或 Agent 实现依赖，默认追加，不改变当前阶段。 |

- 本顺序是默认开发队列；2026-10-07 用户已授权逐阶段实施直到需要新窗口，逐阶段完成实施与非桌面检查；需要桌面构建的验收按最新授权暂缓并单列待办，不伪记完成。阶段 2 可单独提前，阶段 5 的只读入口核实可提前；阶段 4 的正式验收依赖阶段 3。
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

- 状态：已完成（2026-10-07）；LOW → L1。
- 目标：在 Key 配置区持续展示内存、明文与密码加密模式的运行期风险；保留原有明文保存确认。
- 范围与验收：见下方“阶段 2–5 详细任务”；不改变存储默认值、加密格式或 Web 能力。

### 阶段 3｜桌面密钥仅由 Rust 读取与使用

- 状态：进行中；实现与非桌面门禁完成，Rust/原生验收暂缓；HIGH → L3，涉及密钥迁移、共享配置与核心 IPC 边界。
- 目标：前端传配置身份、操作与业务参数，Rust 从现有安全存储取 Key 并绑定目标；不再返回已保存明文 Key。
- 范围与验收：见下方详细任务；保留旧配置、自定义 API、本地免 Key 模型和多协议兼容。

### 阶段 4｜Rust 代理操作约束与滥用限额

- 状态：进行中；实现及非桌面门禁完成，Tauri 编译/代理定向测试与原生验收暂缓；HIGH → L3，依赖阶段 3。
- 目标：在已有网络与资源限制上，补齐操作/接口约束、频率与累计使用上限；由 Rust 强制执行。
- 范围与验收：见下方详细任务；不硬编码仅允许内置供应商，不承诺本地估算等于供应商账单硬上限。

### 阶段 5｜CSP、不可信渲染与 Tauri 权限加固

- 状态：进行中；实现、前端门禁及真实本地Web验收通过，Rust ACL编译/桌面Release/线上部署 NOT TESTED；HIGH → L3。
- 目标：收紧实际不必要的 CSP 与权限，复用现有清洗能力覆盖真实不可信渲染入口。
- 范围与验收：见下方详细任务；保留受支持的安全 Markdown、公式、图表、图片和本地模型。

### 阶段 6｜Agent 按需上下文超限恢复

- 状态：进行中；代码与机器检查完成，原生验收暂缓；MEDIUM → L2。完整目标、范围与验收见下方“阶段 6 详细任务”。
- 目标：正常请求直接发送，仅 Provider 明确返回上下文超限后进行确定性压缩与有界重试；不恢复默认总预算。
- 实施顺序：核实错误与请求入口 → 建立最小超限复现 → 压缩与重试接入 → 定向回归与桌面验收。
- 初步风险：MEDIUM；涉及 Agent 请求消息、异步取消、引用和重试边界。若实际修改触及工具写入执行语义，重新评估，不默认为此授权。
- 暂不处理：模型摘要调用、全局窗口配置、用户预算设置、主动总量裁剪、RAG 算法或持久化格式。

### 阶段 7｜搜索会话失效、实例绑定与导航一致性

- 状态：进行中；搜索实现与定向机器回归完成，原生/新产物启动验收暂缓。MEDIUM → L2，涉及搜索派生缓存、实例生命周期和文件/模式切换。
- 目标：保留搜索输入；旧结果及时失效，当前目标就绪后重建，计数、高亮、导航和替换始终对应当前文档。
- 实施顺序：正式失败回归 → 实例绑定与统一失效 → 模式/内容/替换/清理接入 → 定向检查 → 新鲜桌面 Release 验收。
- 范围与验收：见下方阶段 7 详细任务；不改文档/设置持久化，不新增搜索系统、依赖或功能。

## 阶段 1 详细任务（代码完成，桌面验收暂缓）

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
- 最新授权允许阶段 1 桌面验收暂缓时推进独立阶段；保留未验收项，不重做已提交保存队列。

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

- 本轮实现：保留阶段3按存储记录派生的操作组合；普通代理只允许本仓库更新GET精确端点；配置路径增加编码/点段校验；GET搜索限8192字节/100结果。仅当前已实现的OpenAI Chat/Embedding和四类搜索，未实现的协议继续拒绝。
- 正常需求依据：Agent默认8次工具调用，最终回答/连接测试另有请求；Embedding每批100条，批量失败原有逐条降级；搜索通常5条、连接测试1条；更新自动检查24小时缓存和手动查询。计数测试覆盖10次聊天+101次Embedding+5次搜索的会话样本，但真实高吞吐索引/长会话体验仍待原生验收。
- 实际限额：60秒滑动窗口配置120次、应用240次；进程会话10000次请求/512 MiB响应。达到速率返回RATE_LIMIT_EXCEEDED、累计返回SESSION_LIMIT_EXCEEDED；取消、失败和重试计数不退款，不提供日累计持久化或新设置。大小/并发旧值不降，120秒deadline覆盖排队与ACK。
- 当前验收：纯计数策略5项、前端限额传播/无自动授权重试、Embedding批次终止和既有非桌面门禁PASS；api_http中新增真实Rust代理测试尚未执行，原生合法/攻击/限额/资源释放验收NOT TESTED。阶段保持进行中。

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

- 阶段2已完成真实Web核实；阶段3/4实现与非桌面机器门禁完成，Tauri Rust编译/代理定向测试和原生迁移/鉴权/超限验收NOT TESTED；阶段5实现/前端门禁/真实本地Web通过，Rust ACL编译与原生/线上验收NOT TESTED。独立Rust计数测试仅验证纯策略，静态ACL检查仅验证配置，不替代代理/权限运行时验收；桌面暂缓不等于已完成。
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

- [x] 日常成功请求与修改前发送内容一致，请求次数不增加，无主动总量裁剪、摘要或预算配置。
- [x] 长历史及累计工具结果场景：首次明确超限后有效减少请求，最多重试一次；保护当前真实问题与授权，后续请求不重新塞回被剔除材料。
- [x] 普通错误、取消、deadline 均不触发超限恢复；再次超限或无法压缩时有明确终止结果。
- [x] Agent 工具循环、无候选工具回复及最终回答均覆盖流式/非流式适用分支；部分流式失败不重复显示或污染其他请求。
- [x] 超限重试不重复任何工具副作用、不重置执行预算；来源编号、必要证据和待确认编辑保持有效，不改原始聊天记录或持久化格式。
- [x] 用 mock Provider 的实际生产入口回归上述不变量；类型检查、改动文件 ESLint、定向 Smoke 和 diff 检查通过。
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
- 当前验证：生产入口mock回归、typecheck、改动ESLint和Smoke PASS；真实Provider模型效果与原生验收 NOT TESTED。新增实际回归为 `tests/agent/contextOverflowRecovery.test.ts`；最终命令/结果见阶段6历史。

## 阶段 7 详细任务｜搜索边界修复

### 已确认现象、证据与限制

- 用户环境：桌面 Tauri Release。预览切文件后沿用旧位置；编辑切文件后搜索和导航失效，改关键词无效、关闭重开恢复；同文件编辑→预览后导航无效但用户观察到高亮正常，反向切换用户观察正常。
- 当前源码：`CodeMirrorEditor.tsx` 按 documentKey/settingsKey 重建 EditorView；`SearchOverlay.tsx` 仅按稳定的 editorViewRef 对象安装 searchField，新实例未重新安装，搜索/导航会直接返回。
- `EditorArea.tsx` 按当前模式解析实际搜索目标，但 SearchOverlay key 仍是原 requestId/target；编辑/预览各自匹配数组没有目标、文档或版本失效规则。初始请求只消费一次，且目标未就绪也可能被提前记为已消费。
- 同文件编辑时 searchField 只映射高亮 Decoration，不重算导航数组；单次替换后立即 editorNext 使用旧坐标。预览内容变化清理内部搜索索引，却不通知搜索框清理导航结果；双预览结果只记录 sourceIndex。关闭清理仅捕获首次挂载的目标，可能漏清后来使用的实例。
- 隔离诊断：`node_modules/.cache/search-boundary-audit-0501655b345641cca9977e609766482d/` 中的 `boundary.test.tsx`、`audit.config.ts`；运行 `npx vitest run --config node_modules/.cache/search-boundary-audit-0501655b345641cca9977e609766482d/audit.config.ts --reporter=dot`，最终 7/7 PASS，断言的是异常存在，不是修复通过。首次单次替换探针触发 RangeError，随后捕获该异常并确认 `Selection points outside of document`。
- 七项探针覆盖：稳定 ref 更换实例、编辑→预览、预览→新编辑实例、预览更换文档、同编辑实例插入内容、切目标后关闭、单次短文本替换。探针用真实 CodeMirror + SearchOverlay，预览 handle 为 mock，不等于完整 EditorArea/虚拟预览或安装版验收；临时文件可能被缓存清理，恢复时先核实，不依赖其永久存在。
- 当前源码探针中反向切换也可失效，与用户 Release 反馈有差异；“高亮正常”的来源及双栏、迟到回调仍待真实表面核实。不得用静态解释覆盖用户反馈，不修改已安装产物或把这些差异写成已确认根因。

### 范围与影响

- 开始前读取根/目标目录规则、工程与交接指南、`docs/AI_REVIEW_PROJECT.md`、总指南编辑/预览章节、`docs/architecture/state-ownership.md` 文档/Tab/搜索/阅读位置/缓存章节和 `docs/agent-contracts/markdown-editor.md`、`ui.md`。知识图先做最小查询，过期或不足直接精确搜索，不重建。
- 允许修改：本文件；`src/components/editor/SearchOverlay.tsx`、`EditorArea.tsx`、`CodeMirrorEditor.tsx`、`MarkdownPreview.tsx`、`markdownPreviewTypes.ts` 的必要搜索状态/就绪通知/清理接口；直接相关最少测试；搜索 ownership 文档中因本次实际实现变化而过时的描述。
- Blast Radius：正文真相仍是 Tab.content；匹配由当前编辑器文档或已提交预览全文可见文本投影派生。搜索框持有输入，结果绑定文档 ID、内容版本、实际目标及实例身份；双栏分别识别来源。间接影响 Ctrl+F 选区锚点、复制、高亮注册、替换、虚拟目标补定位及阅读位置恢复。
- 禁止影响：保存队列、文档正文（显式替换除外）、未保存状态、选区高亮/ReadingMark、权限、Store/持久化格式、Rust、DB、AI/RAG、预热/懒加载策略；不顺带拆分 EditorArea。
- 修改 EditorArea/MarkdownPreview 或实例生命周期前遵守同机基线要求；不改变首屏/预热时序或宣称性能收益。若演变为性能敏感改动，执行项目规定的编辑/预览各至少 10 次新旧 Release 冷启动对照；验收暂缓或环境不足明确 NOT TESTED，不能据此标记阶段完成。

### 执行清单

- [ ] **先建立失败回归。** 把临时诊断转为最少正式行为回归，断言应有的正确结果；核实完整模式切换双向路径、实例留存/释放策略和当前 Release 差异，不仅测试 mock handle。正式回归与真实 React/CodeMirror/虚拟预览链路已验证；Release差异仍NOT TESTED。
- [x] **输入与结果分离。** 保留关键词、替换文本；将初始选区请求视为一次性用户指令，不在文件/模式自动刷新时重播旧 anchor，也不通过反复 remount 搜索框解决问题。
- [x] **统一失效。** 文件、内容版本、实际目标、实例或双栏来源变化立即清空旧匹配/计数/活动项，使导航和替换不消费旧快照；就绪前暂停操作。即使两个文件内容相同，身份变化也必须失效。
- [x] **新实例重绑并重建。** 每个实际 EditorView 创建后安装/绑定搜索能力，销毁时解除；不监听稳定 ref 对象来推断实例变化，不轮询或延时猜就绪。编辑器内容 transaction 触发失效/刷新，不等待 Store 输入防抖才能拒绝旧坐标。
- [x] **预览就绪与模式迁移。** 搜索打开且关键词非空时，在当前全文模型提交、旧索引清理完成后重算计数和高亮；不等待整篇 DOM 挂载，不在 handle 未就绪时回退源码扫描并长期保留不同语义结果。编辑仍搜源码、预览仍搜可见文本投影；双栏沿用既有搜索范围。无可见搜索目标（如 diff 模式）暂停并清理绑定，不搜索隐藏实例或新增 Diff 搜索功能。
- [x] **刷新与定位分离。** 自动刷新不滚动、不抢焦点、不改光标/阅读恢复；首次上/下从当前光标或视口按方向选择有效匹配，随后按有效当前项循环。保留用户输入/Ctrl+F 的既有主动定位行为；导航前校验结果身份和版本，拒绝 A→B→C 中 A/B 的迟到结果。
- [x] **内容变化与替换一致。** 输入、粘贴、删除、撤销/重做、外部正文更新、预览局部提交及单次/全部替换后及时刷新；计数、活动项、高亮与导航来自同一有效匹配快照，替换不越界、不重复修改。只对当前编辑目标执行显式替换，不允许旧模式/文档结果参与。
- [x] **清理实际目标。** 退出目标或关闭搜索时解除实际绑定，清理搜索高亮、待刷新回调和未完成搜索补定位；按精确实例清理，旧 cleanup 不清新实例，保留普通选区与 ReadingMark。

### 验收与检查

- [ ] A/B 匹配数与位置不同、同内容不同文件、B 无匹配/空文档、快速 A→B→C、关闭当前/最后 Tab、目标尚未挂载及设置变化重建实例后，输入保留且结果不跨文档，改词可搜索，上/下与 Enter/Shift+Enter 可用。
- [ ] 同文件编辑↔预览双向切换、编辑预览分屏、双预览换任一文件/移除一栏、隐藏或卸载再恢复均正确；不重播旧 Ctrl+F anchor，初始请求等实际就绪后只成功消费一次。
- [ ] 同文件内容改变及单次/全部替换（更短/更长/空串）后计数与导航正确，无 Selection 越界；虚拟未挂载目标可定位，关闭搜索后不迟到跳转。
- [ ] 自动刷新保留焦点和阅读位置；关闭搜索不残留搜索高亮，也不破坏选区复制、ReadingMark 和阅读位置恢复。空关键词不扫描、不导航。
- [x] 正式失败回归转 PASS，typecheck、改动文件 ESLint、定向回归与Core Smoke、diff 检查 PASS；完整当前链路已自审，无无关 diff。
- [ ] 用匿名临时 .md 在新鲜 Tauri Release 验收上述用户路径；核实运行进程/工作区/HEAD，解释与旧安装版的差异。真实桌面和受影响启动检查缺失时维持 NOT TESTED/阶段进行中。

```powershell
# 新增正式失败回归的实际文件并列加入本命令；诊断 7/7 不替代修复验收
npx vitest run tests/editor/SearchOverlay.boundary.test.tsx tests/editor/SearchOverlay.preview.test.tsx tests/editor/SearchOverlay.nearestMatch.test.ts tests/editor/previewTabSwitchRegression.test.tsx tests/editor/modeResourceLeak.test.tsx --maxWorkers=1
npm run typecheck
# 对实际修改文件运行 npx eslint；按生命周期影响选择最小 EditorArea 定向 Smoke
git diff --check
```

- 源码稳定后串行验证；生命周期直接影响现有 `previewTabSwitchRegression.test.tsx` / `modeResourceLeak.test.tsx` 时选对应最小用例，不运行全量测试/全量 E2E/Rust 检查。构建仅用于实际必要的加载边界与新鲜原生验收，不放宽预算。
- 不只在 onRenderComplete 调现有 doSearch：该函数包含滚动，且模型清理时序可能清掉刚重建的结果。不仅追加 activeTabId effect，不复用旧 offset，不用清空配置/持久化或全局 DOM 扫描补救。
- MEDIUM → L2 验收模型；只有用户明确调用后做模型 Review。提示词：`使用 ai-code-review Skill 审查阶段 7 搜索修复 diff，重点核实实例重绑、文件/模式/内容失效、替换坐标、清理和阅读位置；复用机器证据，不扫描无关模块。`
- 明确下一步：搜索实现与机器证据见阶段7历史；只补尚未执行的真实桌面/新产物启动验收，不能复用旧EXE或用mock结果解释安装版差异。阶段8/9需另行指定，阶段1/3/4/5/6暂缓项保持。

## 当前阶段详细任务与明确下一步

阶段7实现与机器回归完成，原生与新产物启动验收暂缓，阶段保持进行中。

1. 恢复先核实git status/HEAD；5个业务文件、3个直接测试、搜索ownership和本计划的阶段7更新已获本地提交授权，实际提交号以git log核实。保留本计划既有阶段8/9内容、`.workbuddy/`及`src-tauri/target-reading-position-baseline/`，不回退、不清理、不自动提交。
2. SearchOverlay输入独立保存，实际binding捕获目标key、精确EditorView/预览handle、正文快照与双栏来源；EditorView.doc变化立即拒绝旧坐标，microtask只刷新当前存活binding。不要恢复监听稳定ref或反复remount搜索框。
3. CodeMirrorEditor在真实创建/释放后通知；EditorArea保存就绪元数据ref，只有搜索打开才触发父级刷新。预览在清掉旧搜索索引并安装handle后通知；当前Tab正文与显示模型不匹配时暂停，不使用源文本fallback。
4. 自动刷新不选中/滚动，0/N表示尚未主动选择；首个上/下按当前光标/视口方向选取。Ctrl+F文本与anchor就绪后消费一次；切文档/模式不会重播。替换前校验doc身份，单次/全部替换按新快照刷新，replacement中的$作为字面文本。
5. 搜索关闭/目标切换解除精确Compartment与listener；旧刷新回调不得写新实例。MarkdownPreview的搜索补定位标记kind=search，只清搜索层/搜索补定位，普通选区、来源跳转和ReadingMark保持原生命周期。
6. 机器门禁与失败/夹具记录见阶段7历史；继续原生暂缓时不运行Rust/打包或重试旧内存失败构建。用户恢复后构建匹配HEAD的Tauri Release，用匿名临时.md验收A/B/C、同内容不同文件、双向模式、双栏/隐藏/恢复、内容/替换、清空/关闭、虚拟目标及阅读位置；明确解释旧安装版与源码双向切换差异。
7. 修改前已执行旧EXE编辑/预览各3次冷启动基线；这是搜索局部修复，不改lazy/prewarm/首屏打点，不宣称性能收益。新产物启动对照NOT TESTED；若后续演变为性能敏感改动，编辑/预览各至少10次新旧Release对照，按项目规则报告中位/P90/max。
8. MEDIUM→L2，未执行独立模型Review；建议：`使用 ai-code-review Skill 审查阶段7实际diff，重点核查实例重绑、文件/模式/正文失效、替换坐标、清理与阅读位置；复用机器证据，原生维持NOT TESTED，不扫描无关模块。`
9. 阶段8为阅读成果来源与区块定位新范围，用户明确指定后按末尾阶段8计划执行；建议新窗口，不在本阶段提前改成果/AI/DB。

### 阶段6参考恢复点（保留原生待验收）

阶段6已本地提交，代码与非桌面机器门禁完成；原生暂缓，仍进行中。以下保留其消息/重试决策，不据此重做阶段6。

1. 恢复先核实git status/HEAD，只读取阶段6相关实际diff、下方最新历史与Agent/AI契约，不重复已完成实现。现有阶段8/9文档内容及两个未跟踪目录必须保留。
2. `markCurrentTurnStart` 标记Agent系统消息+历史之后的首条本轮消息；直答在 `buildMessagesForModel` 标记本轮参考资料或问题。WeakSet按对象身份保存运行时边界，Provider发送内容不变；最终回答两层构造均保留对象引用，不能以后改成克隆却遗漏边界转移。
3. `withContextOverflowRecovery` 首次请求原样发送；仅明确上下文错误、未取消/超时且消息减少时重试一次。压缩移除所有旧完整问答与完全相同的生成工具结果组；system、本轮问题/参考资料/授权/确认/独立工具证据/来源ID与最终指令保持。不恢复固定总预算，不截断JSON，不将模型材料升级为授权。
4. executor把压缩数组作为本轮后续请求真相；不清步骤、缓存或工具预算，不重跑工具。流式与最终回答在重试前仅清本请求已经发布的部分文本，旧帧已flush/取消；信号取消、deadline与普通错误不重试。无安全压缩或二次超限统一提示缩小范围。
5. 模拟Provider实际入口覆盖普通成功、有工具流式/非流式、无候选工具回复、最终回答、来源保留、重复读缓存、确认卡片、普通错误、取消、deadline与部分流式复位。测试夹具需声明允许工具参数；注册parameters=[]再传targetId/newText会被原有权限规则拒绝，不能为夹具放宽生产校验。
6. 剩余下一步：用户恢复原生验收后，使用新鲜匹配工作区/HEAD的Tauri产物和匿名可控服务验收正常请求、明确超限、再次超限、无法压缩、取消、流式展示、确认与来源；不得读取真实Key或把mock PASS写成原生PASS。当前不编译Rust/打包，不重试此前环境失败的构建。
7. MEDIUM→L2中等模型；未调用独立模型Review。提示词：`使用 ai-code-review Skill 审查阶段6 diff，重点核查真实轮次边界、错误分类、重试副作用、流式取消与引用完整性；复用机器证据，原生维持NOT TESTED，不扫描无关模块。`
8. 阶段7是编辑器/预览搜索实例的新范围；用户指定后新窗口从阶段7详细任务的失败回归开始，不在本阶段继续搜索、阶段8/9或旧安全实施。

### 阶段5参考恢复点（保留未验收依赖）

阶段5实现与前端门禁、本地Web验收已接通；阶段1/3/4/5原生验收继续暂缓。以下仅保留阶段5待验收信息；阶段6实现已完成，恢复按上方当前阶段说明。

1. 用户恢复阶段5原生验收后，先核实git status/HEAD及新鲜产物，复用阶段5已通过机器证据，只补下列未验收项；继续暂缓时不强行跑Rust/打包。
2. 阶段5唯一新增运行期边界是ECharts解析副本；不改Tab.content、保存、预览全文模型、Store、DB、依赖或动态加载时序。HTML/SVG复用markdownHtml清洗，Mermaid现有strict和库内DOMPurify已在真实页核实，不能新增第二套renderer。
3. Web CSP在Vite最终HTML中加meta/hash，保持index.html原有启动脚本；Desktop由Tauri自身注入hash/nonce。不要机械删除style unsafe-inline，否则CodeMirror动态样式可能被阻止；不要将Web策略注入Desktop。Web的http:是Chromium不接受IPv6 host-source的兼容例外，JS请求校验不是恶意脚本的网络隔离保证；meta不支持frame-ancestors，线上服务器如可配置应另补响应头。
4. main.toml显式列出65个当前command的精确allow清单（提交前与最新HEAD核对一致）；AppManifest自动读permissions并启用应用ACL，不需要生成每命令重复文件。capability只用webviews=[main]、local=true；不要再加windows=[main]（会扩大同窗口子WebView匹配）。dialog confirm保留给插件重写的window.confirm，通知走现有Rust命令，FS/Origin/凭据后端校验保持。
5. ECharts tooltip固定richText，未配置时show=false；拒绝启用dataView的HTML surface、危险协议、协议相对/远程资源及SVG data URL，保留禁用dataView与安全栅格data图像。固定解析/渲染错误不含原始配置值。兼容取舍：原有HTML tooltip变为文本，HTML数据视图改用图表/Markdown表格，不清空用户文档。
6. 可复用本轮PASS，具体文件/命令/产物在阶段5历史。新鲜Desktop Release、Rust ACL生成/编译、运行时未知命令/非main/远程WebView拒绝、正常dialog confirm/SQL/文件/通知/全屏、asset与本地模型仍NOT TESTED；恢复原生验收时用合成配置与临时文档，核实进程/工作区/HEAD，不用Web dist替代Desktop。
7. 阶段6生产入口mock回归与实现已完成，恢复点见上方，不重复旧任务；阶段7等待明确指定，不顺带修搜索。
8. HIGH→L3；未执行独立模型Review。提示词：`使用 ai-code-review Skill 审查阶段5 diff，重点检查CSP/hash兼容、ECharts HTML入口、主WebView ACL及正常功能回归；复用机器证据，原生/线上维持NOT TESTED，不扫描无关模块。`

### 阶段4参考恢复点（保留未验收依赖）

阶段4实现与非桌面门禁已接通，源码已提交；以下为暂缓原生验收的参考，不是本轮新增范围。

1. 恢复先读当前状态、阶段4详细任务、external-http契约及最新历史；核实git status/git log。阶段4九文件已按用户要求纳入本次本地提交，保留两个既有未跟踪目录；不自动追加提交、推送或推进阶段5。
2. 计数唯一所有者是Rust ApiOriginState.usage，短Mutex原子处理滑动窗口/会话累计；临时状态不持久化。授权后、排队前计数；所有收到字节均计数，已排队请求发送前再检查输出余额。现有2/16 MiB、并发8保持，timeout覆盖队列和ACK，取消保留requestId到最终清理。
3. externalFetch普通代理只服务精确本仓库更新URL；聊天/Embedding/搜索必须由存储记录派生操作目标。路径校验不拒绝安全空格/Unicode编码，拒绝点段及编码跳转；不要用固定供应商名单破坏自定义/本地服务，不改变DPAPI格式、迁移确认或Key语义。
4. 测试探针已把自定义/本地/取消/重定向改走externalApiFetch；mock克隆请求，不能污染授权重试的入参；取消须等配置和requestId注册后触发。Embedding限额从批量/逐条分支立即抛出，已有队列记失败，不改索引算法。
5. 可重复轻量验证：`rustc --edition 2021 --test src-tauri/src/api_http_limits.rs -o D:\temp\guanmo-stage4-limits-tests.exe` 后执行该EXE；`npm run test:ai-http -- --frontend-only`；`npx vitest run tests/rag/embeddingInput.test.ts --maxWorkers=1`。已有PASS无需无故重跑；不要并行重型检查。
6. 用户恢复桌面验收后先串行执行 `cargo test --manifest-path src-tauri/Cargo.toml api_credentials --lib --jobs 1` 与 `npm run test:ai-http`，覆盖新增更新端点/编码路径/计数接入/重复ID测试和既有DNS/取消/ACK测试；再用新鲜Tauri产物与匿名本地服务验证合法鉴权、未授权/伪造拒绝、突发及并发、累计边界、取消/超时/ACK阻塞清理。使用合成Key与隔离临时配置，不读取真实Key，不删缓存或放宽门禁。补充当前代理运行时的限额集成证据，不以纯计数测试代替。
7. 阶段3尚未编译/原生验收；恢复时仍需下方阶段3参考恢复点的迁移、预设、反射防护与冷启动验收。阶段4状态只有这些依赖与实际表面通过后才能完成。阶段5是新的渲染/CSP/ACL范围，需另按其契约核实，不以本阶段结果宣称消除XSS。
8. HIGH→L3强模型；尚未执行独立模型Review。建议调用：`使用 ai-code-review Skill 审查阶段4 diff，重点检查Rust精确操作/路径、会话计数、防配置绕过、排队与ACK取消超时、Embedding限额终止；复用机器证据，原生暂缓维持NOT TESTED。`

### 阶段3参考恢复点（保留未验收依赖）

阶段 3 实现已接通；保留以下原生恢复说明，不重做已提交阶段1/2/3。

1. 新窗口先读取根规则、当前状态、阶段 3 详细任务和最新历史，执行 `git status --short` 与 `git log -1`；阶段 2/3 和阶段 7 计划已按用户授权纳入本次本地提交。保留两个既有未跟踪目录，不自动追加提交/推送/tag/Release/PR。
2. 核心实现：`api_credentials.rs` 复用 `secrets.json`/DPAPI，记录包含类型、协议、规范化地址和 Key；身份为该三元组的确定性编码（非秘密、不靠前端声明 ID）。`configure_api_connection` 只返回身份/已配置状态；同目标模型/预设共享连接，不同目标保留各自 Key，返回原目标时恢复元数据。未实现协议继续拒绝，非 Windows 明确拒绝安全存储，不明文回退。
3. 旧格式：本机 DPAPI 旧槽位无可信目标，因此 Rust 在非主线程原生确认类型和 Origin；前端不能传确认结果，写入锁内重新检查，取消保留原数据。LocalStorage 三类旧 Key/旧预设只作受控导入；其他设置写入时保存在 `legacyApiCredentials` 重试包内，保留原地址，包不进入运行时 Store；确认成功后精确清除。迟到旧明文导入不覆盖新保存的绑定 Key；无地址项保留，不猜新 Origin。原生取消/失败流程未测。
4. 请求：`externalApiFetch` 传配置身份、受限操作、业务体/搜索参数、超时和 requestId；Rust 从绑定记录生成目标/方法/鉴权，禁止 URL/headers/method 覆盖。SSE/ACK/取消和原资源限制复用；当前 Key 反射通过响应头过滤与跨分块后缀检测拒绝，但不承诺阻止供应商任意编码密钥。普通代理现已收窄为更新接口，阶段4速率/会话累计实现见当前恢复点。
5. 前端：桌面输入是 `DesktopApiKeyControl` 本地草稿，成功清空，失败保留可重试草稿/固定错误；空白保持原值、删除显式；本地模型仍可免 Key，桌面保留可选 Key 的删除/替换入口。Store 只含状态/运行时版本；按类型串行更新并用版本+地址身份拒绝迟到元数据，配置变化使缓存 Provider 失效。App/useAiChat 只改就绪/缓存判断，未改首屏时序；单例曾缓存旧实例，Hook 现在确保当前 Provider 真正重建。Web 原存储模式和搜索鉴权通过别名保留；不要把桌面身份接口变成浏览器直连回退。
6. 桌面暂缓期间可复用本轮非桌面 PASS。用户恢复后先串行运行 `cargo test --manifest-path src-tauri/Cargo.toml api_credentials --lib --jobs 1` 和 `npm run test:ai-http`（后者包括 `api_http` 定向 Rust 测试）；出现编译或实际安全失败只修本阶段首个根因，不放宽测试/门禁。`--frontend-only` 仅前端，不是 Rust PASS。
7. 再构建新鲜 Tauri Release，用匿名隔离配置/本地服务验收冷启动、原生确认取消/同意、三类旧数据迁移及失败重试、保存/替换/删除、预设 A→B→A、聊天/模型列表/Embedding/搜索鉴权、跨目标/头伪造拒绝、响应反射拒绝和 SSE/取消。核实运行进程、工作区和 HEAD；旧 EXE 不代替。App 就绪适配的冷启动对照也 NOT TESTED，不宣称性能收益。
8. 阶段 1 原生恢复点仍见其历史：旧 EXE 编辑/预览各 3 次基线；`D:\temp\guanmo-save-native.mjs` 为未执行草稿，先核实。之前 Rust 内存失败，不删缓存/关闭用户程序/改页面文件强行通过。阶段 3 Web 构建证据见 `D:\temp\guanmo-stage3-web-build.txt`；恢复新桌面构建不能复用 Web `dist/`。
9. 本轮已自审当前 diff 和实际调用链，知识图仍落后 HEAD，不重建；未执行独立模型 Review。HIGH → L3 强模型，建议提示词：`使用 ai-code-review Skill 审查阶段 3 diff，重点检查密钥不返回前端、原生迁移确认及竞态、目标绑定、旧数据保留和三类鉴权入口；复用机器证据，桌面暂缓维持 NOT TESTED，不扫描无关代码。`

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

### 2026-10-07｜阶段 2 常驻安全提示与阶段 3 交接

- 状态：阶段 2 已完成；当前切换阶段 3 未开始。阶段 1 保持进行中，桌面构建/原生验收依最新用户授权暂缓；本次允许推进独立阶段，不把暂缓记 PASS。
- 完成内容：在 Web API Key 共用配置卡片增加无条件常驻提示，覆盖内存、明文、密码加密以及锁定/解锁；说明运行期脚本风险、密码加密局限及专用低额度可撤销 Key/供应商消费上限。沿用主题文字令牌和自然换行，不增加按钮、确认或状态逻辑。
- 实际修改：`src/web/WebSettingsPage.tsx` 仅新增一段 JSX 文案；本计划更新状态与下一步。两文件未提交。阶段 1 已提交于 `64d1f1980266d054594c56207d74101453b5062c`，不是未提交业务 diff；既有未跟踪目录均保留。
- PASS：`npm run typecheck`、`npx eslint src/web/WebSettingsPage.tsx`、`git diff --check`；Playwright CLI 独立非持久 Edge 会话访问本地 Vite Web 页面，核实三种模式提示、内存保存、明文取消/确认、加密保存后密码清除、刷新锁定、解锁恢复两把合成 Key、清除后输入为空、设置关闭/返回。未发真实供应商请求。
- 视觉 PASS：1280×900 浅色锁定；390×844 深色三种模式提示包围盒未越界；浅色/深色窄屏截图已人工读取，提示完整换行、无截断。截图在已忽略 `output/playwright/stage2-light-locked.png`、`stage2-dark-narrow.png`、`stage2-light-narrow.png`，CLI 快照/日志位于已忽略 `.playwright-cli/`，不纳入交付。
- 环境/探针问题：默认 Chrome 路径不存在，改用现有 msedge；首次刷新出现 ERR_INSUFFICIENT_RESOURCES 导致设置等待超时，一次重新导航后恢复并完成锁定/解锁验证。窄屏循环的三模式断言通过后，主题按钮可访问名称与实际 data-theme 不一致导致探针末尾等待超时；读取实际 data-theme 并按现有按钮操作后确认 light，截图复核通过。未为这些问题修改产品逻辑。
- 自审：LOW；当前 diff 不涉及共享状态、生命周期、权限、格式或请求，未发现本次引入的 P0/P1；不新增镜像测试、不执行全量测试/构建或独立模型 Review。线上部署与桌面表面 NOT TESTED，本阶段只验收真实本地 Web 页面。
- 下一步/会话：阶段 3 转入 Rust 密钥、配置迁移与跨协议 IPC，建议新窗口，按“当前阶段详细任务与明确下一步”恢复；保留连续推进授权和桌面验收暂缓约束。

### 2026-10-07｜阶段 3 密钥内部使用与非桌面验证

- 状态：进行中；实现及非桌面机器检查完成，用户主动暂缓桌面构建；Rust 定向测试/编译和真实原生验收均 NOT TESTED。阶段 4 未实施，无提交或远程操作。
- 实施：Rust 持有绑定配置，三类 Key 不返回前端；移除 `load_secret/save_secret/delete_secret` 注册和旧读取实现，DPAPI 继续复用且原子更新/全局写锁，非 Windows 不再明文回退。凭据请求由 Rust 生成目标/鉴权；响应反射检测跨分块，普通代理拒绝前端鉴权头。
- 设置/兼容：新增本地草稿控件和元数据就绪判断，本地模型 Key 可选但保留删除入口，留空不变、显式删除/替换、成功清空/失败重试；每类型串行更新且迟到结果不污染新目标。旧明文/预设的重试包保留原身份，不进入 Store，不覆盖新保存 Key；旧 DPAPI 无可信目标，首次迁移须原生确认，锁内重新核实防竞态。缺少地址的旧 Key 原样待处理。
- 影响范围：新增 `src-tauri/src/api_credentials.rs`、`src/services/apiConnection.ts`、`legacyApiCredentials.ts`、`DesktopApiKeyControl.tsx` 和控件测试；修改 `api_http.rs/lib.rs`、`secureStorage/settingsSecrets/settingsStore`、AI types/client/provider、`webSearch/externalHttp`、桌面 SettingsPage、App/useAiChat 的就绪缓存、Web 两个别名、前端 HTTP 检查脚本及直接测试/契约/本计划。各项均服务于同一个密钥闭环；没有依赖、DB、保存队列或 Agent 执行语义改动。原阶段 2 Web 提示原样保留。
- PASS：`npx vitest run tests/services/settingsSecrets.test.ts tests/services/desktopApiKeyControl.test.tsx --maxWorkers=1`（2 文件 10 项）；`npm run test:ai-http -- --frontend-only`（生产 Provider/模型列表/独立 Embedding/搜索/Reasoning 回退/SSE/Origin/取消及 IPC 无鉴权头）；`npm run test:smoke`（2 文件 8 项）；`npm run test:privacy-logs`；typecheck；改动文件 ESLint（0 error/5 既有 warning）；Rust 三文件 rustfmt；`git diff --check`。没有将 mock 宿主结果写成原生 PASS。
- Web build/bundle gate PASS：最终入口 1,170,260 bytes、总 JS 6,629,472 bytes、86 chunks。`D:\temp\guanmo-stage3-web-build.txt` 保存构建证据；Web 构建仅验证共享别名/导出和产物边界，浏览器真实网络/在线部署未测试。
- 检查中修正：控件 `danger` 类型不受本机 Button 支持，使用默认按钮/错误色；首次脚本 ESLint 缺 Node 全局声明，改显式 Node 导入后 PASS；发现 Web 别名需要新导出，已保留原 Web 搜索鉴权；自审发现旧无绑定 DPAPI 可被前端伪造迁移目标，增加原生确认与锁内复核；发现迟到明文迁移可能覆盖新 Key，增加仅缺失时导入和定向回归。
- NOT TESTED：Rust 新接口的编译/测试、真实 DPAPI/原生确认、真实匿名 HTTP 鉴权及反射拒绝、新桌面产物/冷启动/设置交互；桌面前端构建也按用户要求暂缓。Rust 源码格式/解析不替代类型检查。阶段 3 不标记已完成，也不宣称解决代理滥用或 XSS。
- 会话建议：建议新开窗口；状态、决策、失败路线、修改范围、机器证据与恢复命令已在本文件记录。

### 2026-10-08｜追加搜索边界修复计划

- 状态：阶段 7 未开始；当前阶段仍为阶段 3，原有阶段 1/3 桌面验收限制、阶段 4–6 顺序与全部历史保留。
- 完成内容：记录桌面 Release 反馈和当前源码七项隔离诊断，采用输入保留、结果身份/版本失效、新实例重绑、就绪重搜与定位分离；覆盖内容变化、替换、双栏及关闭清理，明确原生差异待核实。
- 实际修改：仅本文件，保留其既有未提交内容以及全部工作区改动；业务代码、正式测试、依赖、配置均未修改，未提交或执行远程操作。
- 验证结果：本轮 `git diff --check -- AI_IMPLEMENTATION_PLAN.md` PASS；沿用本会话此前隔离诊断 7/7 PASS（证明异常存在），不重跑。搜索修复回归、新鲜桌面 Release 与启动验证均 NOT TESTED。
- 下一步：按原队列恢复当前阶段，或用户明确指定执行阶段 7；搜索先建失败回归，不能把加入清单当作业务实现完成。

### 2026-10-08｜阶段 2/3 本地提交授权

- 用户要求：提交现有修改并详细描述所做内容；仅本地提交，不执行推送、tag、Release 或 PR。
- 范围：27 个文件，包含阶段 2 Web 安全提示、阶段 3 Rust 密钥/目标绑定与前端适配、直接测试/检查脚本/契约，以及本计划中的阶段 7 搜索修复待办；搜索业务代码未实施。
- 保留边界：`.workbuddy/` 与 `src-tauri/target-reading-position-baseline/` 原样保留且排除；不夹带阶段 1 已提交源码，不修改依赖或 DB schema。
- 验证：复用阶段 2/3 既有机器 PASS；本次核实暂存范围并执行暂存 diff 检查，不重跑桌面构建或 Rust 测试。实际提交号以 git log 为准。
- 状态：阶段 1/3 继续进行中；Rust 编译/定向测试、新鲜桌面产物和原生验收维持 NOT TESTED，阶段 4–7 未开始。

### 2026-10-08｜阶段4操作约束与会话限额

- 状态：进行中；实现及非桌面门禁完成，沿用用户桌面验收暂缓授权。阶段1/3保持进行中，不推进阶段5，不提交或执行远程操作。
- 实现：普通代理只允许本仓库更新GET端点与必要头；绑定记录继续决定聊天/模型/Embedding/搜索方法和端点。拒绝未知IPC字段、路径跳转与危险编码，保留安全空格/Unicode路径。GET搜索参数有界。Rust独占滑动窗口和应用会话累计：配置120/分钟、应用240/分钟、会话10000请求/512 MiB响应；配置切换不重置，失败/取消不退还，重启重置，不作费用保证。
- 生命周期：入队前计数，接收网络字节累计，发送前再次检查输出容量；deadline覆盖并发排队/网络/ACK等待。重复活动requestId拒绝，取消保留身份到cleanup，避免迟到清理误删新请求；既有并发8和2/16 MiB不改。新增限额错误从Provider传播，Embedding批量和逐条fallback遇限额停止，既有失败队列语义保持。
- 修改9文件（均未提交）：新增src-tauri/src/api_http_limits.rs；修改api_http.rs、api_credentials.rs、lib.rs、src/services/rag/pipeline.ts、scripts/ai-http-transport-check.ts、tests/rag/embeddingInput.test.ts、docs/agent-contracts/external-http.md和本文件。必要扩展pipeline仅为限额终止，未改RAG算法、存储格式、依赖、配置/CSP或Agent语义。两个原有未跟踪目录保留。
- PASS：`rustc --edition 2021 --test src-tauri/src/api_http_limits.rs -o D:\temp\guanmo-stage4-limits-tests.exe`及该EXE（5项：滑动窗口、配置切换/全局累计、字节累计、正常样本、并发原子性）；`npx vitest run tests/rag/embeddingInput.test.ts --maxWorkers=1`（15项）；`npm run test:ai-http -- --frontend-only`；`npm run typecheck`；改动三TS文件ESLint（0 error/1既有prefer-const warning）；`npm run test:privacy-logs`；`npm run test:smoke`最终2文件8项；三Rust文件rustfmt及最终git diff --check。
- 验证中问题：HTTP旧探针修改传入请求对象，凭据授权重试被污染；mock改为structuredClone，不改生产请求。取消探针需等待配置与请求注册，已改为有界微任务等待。Core Smoke首次编辑器内容等待失败（CoreSmoke.test.tsx:173），串行重跑8/8 PASS，证据D:\temp\guanmo-stage4-smoke.txt；未改测试断言、生产编辑器或放宽超时。
- NOT TESTED：完整Tauri crate的编译/api_http/api_credentials定向测试，DPAPI与合成本地服务的真实鉴权、攻击端点、突发/并发/累计、SSE/取消/超时/资源释放；新鲜桌面产物/原生设置/冷启动。纯计数Rust测试不替代这些证据，阶段3依赖仍未验收。不宣称防滥用/XSS安全闭环已验收。
- 自审：当前diff与真实入口链核实，HIGH→L3；未发现已确认的本阶段阻断缺陷，独立模型Review未执行。知识图落后HEAD，使用源码补查，不重建。工程/API/交接guides实际位于C:\Users\惜\.codex\guides，本轮已读；不再沿用历史“本机不存在”的判断。
- 下一步：按当前恢复点完成暂缓的阶段3/4原生验收；若用户另要求阶段5，建议新窗口，先核实实际渲染/CSP/ACL范围，不重做现有阶段。

### 2026-10-08｜阶段4本地提交授权

- 用户要求：提交阶段4修改，提交描述详细；只做本地提交，不执行远程操作。
- 精确范围：阶段4九文件（含新增api_http_limits.rs及本计划）；排除并保留.workbuddy/与src-tauri/target-reading-position-baseline/。
- 验证：复用本轮已经执行的机器PASS，提交前核实精确暂存范围并执行git diff --cached --check；不重跑桌面构建或扩大回归。
- 状态：阶段4仍为进行中，阶段1/3原生验收与阶段4Tauri编译/真实代理验收继续NOT TESTED；本地提交不等于完成验收。实际提交号以git log为准，不自动推进阶段5。

### 2026-10-08｜阶段5防注入、CSP与主WebView权限

- 状态：进行中；实现、前端机器门禁、真实本地Web开发/生产验证已通过。Rust ACL生成/编译、Desktop开发/Release和线上部署NOT TESTED，沿用原生暂缓，不宣称完整安全闭环已验收。阶段6/7未实施；下一阶段Agent消息/重试是新范围，建议新窗口。
- 已核实链路：MarkdownPreview、全屏/分屏共用markdownHtml清洗（rehypeRaw→SVG修复/作用域化→sanitize→安全SVG引用）；Mermaid strict且库内DOMPurify清洗最终SVG，没有bindFunctions回调执行。两条既有链路保留。ECharts string formatter进入TooltipHTMLContent、dataView title/lang进入innerHTML；新增失败回归8项先FAIL，修复后PASS。这是入口/隔离证据，未在旧安装版复现脚本执行，不据此声称真实用户曾受攻击。
- Blast Radius/风险：HIGH→L3。直接影响Desktop/Web CSP、Web HTML转换、自定义command ACL和ECharts派生option；间接影响启动主题/点位、动态样式、公式字体、图片/本地资源、图表/全屏、正常网络、dialog/SQL/通知/窗口操作。正文与权限参数所有权不变；不改Store、保存、AI/RAG、DB、依赖、预热或组件生命周期时序。预览/EditorArea/index.html均未修改，不宣称性能收益。
- 实现：Desktop script unsafe-inline移除，connect仅self/IPC，devCsp另加1420 HMR；Web最终HTML meta授权四个既有启动脚本hash，开发React preamble也按实际HTML授权。两端保留style unsafe-inline和安全图片/字体，拒绝iframe/object/base/form。main.toml精确允许62个已注册command，build.rs显式AppManifest读取；capability只匹配本地main WebView，不给remote或窗口通配。移除重复dialog/sql defaults、未使用的JS通知/set-title权限，保留原生confirm。后端FsAccessState、凭据绑定、Origin和SQL边界未更改。
- ECharts：tooltip强制Canvas richText，缺少配置时show=false，保留格式模板文本；拒绝启用HTML dataView、危险/混淆协议、image://远程、协议相对资源、SVG data URL，保留安全栅格data URL和显式禁用dataView。解析/渲染提示使用固定错误。文档源码不改，不清配置/历史数据；HTML tooltip和HTML数据视图的兼容取舍已记录。
- 修改15文件（全部未提交）：src-tauri/{build.rs,tauri.conf.json,capabilities/default.json,permissions/main.toml}；vite.config.ts、scripts/webCsp.ts；src/services/echartsOption.ts、src/components/editor/EChartsBlock.tsx；tests/services/{echartsOption,renderingSecurity}.test.ts、tests/markdown-preview-prototype/html-sanitize.test.tsx；docs/agent-contracts/{markdown-editor,desktop-services}.md、docs/web-deploy.md；本计划。HEAD为25df3987c21f6b51c90acf731bec6130eea31935；两个既有未跟踪目录保持原样。output/.playwright-cli证据为已忽略临时文件，不纳入提交。
- PASS：`npx vitest run tests/services/echartsOption.test.ts tests/services/renderingSecurity.test.ts tests/markdown-preview-prototype/html-sanitize.test.tsx tests/markdown-preview-prototype/svg-sanitize.test.tsx --maxWorkers=1`（40项）；最后解析/CSP/ACL受影响回归21/21，补充无tooltip不新增提示的断言后图表18/18；`npm run typecheck`；七个改动TS/TSX文件ESLint；`npm run test:privacy-logs`；`npm run test:smoke`（2文件8项）；`rustfmt --edition 2021 --check src-tauri/build.rs`；`git diff --check`。ACL测试仅静态清单/配置一致性，rustfmt仅格式/解析，均不是运行时授权PASS。
- PASS：`npm run build:desktop`（前端，不含Rust）及bundle gate，入口1,153,542 bytes、JS总6,907,011 bytes、101 chunks；`npm run build`及Web bundle gate，入口1,170,291 bytes、JS总6,629,970 bytes、86 chunks。仅有既有大chunk提示，不放宽预算；证据D:\temp\guanmo-stage5-desktop-frontend.txt与guanmo-stage5-web-frontend.txt。当前dist是Web，恢复Tauri验收必须重新构建Desktop前端，不复用。
- 真实本地Web PASS：Playwright CLI独立非持久Edge会话，Vite Web开发15010及最终Web静态预览15011；通过真实新建文档、CodeMirror输入匿名fixture、预览按钮进入。HTML/SVG script、事件、javascript链接、iframe清除；尝试Mermaid init切loose和click脚本未执行；开发页实际ECharts实例showTip验证richText，生产页hover/图表/公式/图片/安全链接/SVG/Mermaid/全屏及退出正常。额外插入inline script及onclick触发script-src-elem/attr拒绝，attack=0、ipc=false；HTTPS与[::1]HTTP的合成route请求通过，不发供应商请求。截图output/playwright/stage5-web-production.png已查看，fixture在同目录stage5-attack.md。生产favicon 404是既有无图标请求，两条CSP错误是主动攻击探针预期，普通运行无CSP错误。
- 失败/避坑：Chromium忽略http://[::1]:*/ws://[::1]:*来源；Web使用http:保留现有IPv6模型并显式记录较宽兼容例外，不能宣称恶意脚本只能连接回环。meta不支持frame-ancestors，线上防嵌入仍需响应头。Lint拒绝含控制字符的regex，改按字符码过滤且保持混淆协议回归。PowerShell npx.ps1动态参数和npx.cmd的HTML参数转义失败，改直接node调用已安装CLI JS入口；不为探针改业务。读取实际dialog init发现window.confirm→plugin:dialog|confirm，补保留对应精确权限，禁止误删。
- 自审：当前diff及实际依赖入口检查，过期知识图只辅助定位（未重建）；没有已确认的本次P0/P1阻断项，未自动调用独立模型Review。NOT TESTED：Rust ACL生成/编译、真正未知/非main/远程command拒绝、Desktop启动hash/IPC/样式/asset/网络/文件/SQL/通知/原生confirm，以及线上GitHub Pages的部署CSP。Web页面没有IPC只证明Web产物，不证明桌面攻击权限隔离。
- 明确下一步：新窗口从阶段6详细任务和当前恢复点开始，保持正常请求原样、明确超限才压缩、真实当前轮次/授权/引用保留、每请求一次重试、流式复位与取消、工具副作用不重复；保留阶段1/3/4/5暂缓项，不顺手改阶段7。使用ai-code-review独立验收阶段5时建议L3强模型，调用词见顶部恢复点。未提交、推送、tag、Release或PR。

### 2026-10-09｜阶段5本地提交授权

- 用户要求：提交阶段5修改，中文描述详细；只做本地提交，不执行远程操作或推进阶段6。
- 精确范围：阶段5十五文件，包含CSP/主WebView ACL、图表防注入、直接测试、三份契约及本计划的阶段5状态/历史。阶段8/9追加计划仅保留在工作区，不纳入本提交；两个既有未跟踪目录和临时验证产物均排除。
- 验证：复用本会话已执行的阶段5机器与本地Web PASS；提交前检查精确暂存清单及git diff --cached --check，不重复构建/测试，也不把其他已提交阅读成果改动夹入。
- 提交前漂移核实：当前HEAD新增的阅读成果整理命令已有对应ACL条目，精确清单共65个，与generate_handler一致；保留这些必要权限，不夹入此前已提交的Rust/DB业务源码。历史阶段5实施时的62个命令记录保持原始证据。
- 状态：阶段5仍进行中，Rust ACL编译、新鲜桌面Release和线上部署维持NOT TESTED；本地提交不等于完整安全验收。恢复阶段6前核实工作区与提交记录，保留暂缓项。

### 2026-10-09｜阶段6实施与非桌面验收

- 状态：进行中；实现和机器验证完成，真实Provider超限/原生验收暂缓为NOT TESTED。阶段1/3/4/5暂缓不变，阶段7/8/9未实施。
- Blast Radius：MEDIUM→L2。真相仍是聊天Store/持久化消息、当前授权scope和执行器步骤/工具缓存；仅模型请求副本拥有本轮边界与压缩数组。直接影响executor、contextBudget、aiChatFlow、aiChatMessages；useAiChat间接消费最终回答、流式与来源。异步取消/重试是风险信号；不得改变工具权限/执行顺序、预算/deadline、原始会话、确认、引用ID、Store/DB/Rust、配置或启动时序。
- 修改：4业务文件 `src/services/agent/executor.ts`、`src/services/ai/contextBudget.ts`、`src/services/aiChatFlow.ts`、`src/services/aiChatMessages.ts`，新增 `tests/agent/contextOverflowRecovery.test.ts` 及本计划；均未提交。保留阶段8/9既有未提交文档和两个未跟踪目录；HEAD基线0d9781ce7c52f6623e1b677f1ccd15c13714f44b。
- 实现：请求消息对象WeakSet标记当前真实轮次起点，不增加消息字段/持久化；首次请求不裁剪。仅上下文错误触发统一单次恢复，保留结构化code/状态与必要文本兼容，排除网络/鉴权/限流/服务异常/取消；删除多轮完整旧历史与完全相同的生成工具结果组，不截断或压缩独立证据，不改来源映射。压缩数组后续复用，不重执行工具或重置预算；失败明确建议缩小范围。唯一当前材料超大时不保证能恢复。
- 流式：Agent模型响应与最终streamFinalAnswer重试先清当前已发布部分文本，旧帧flush/取消后重新累计；每次重试前重新检查取消/deadline，取消后不发布迟到内容。不清其他消息或时间线。无候选工具分支沿用原有非流式chat实际实现，不借任务改变其正常行为。
- 失败复现：新增生产入口回归在修改前10项中9项FAIL，证实只删一轮/不复用、原样重试、错误分类过宽、终止提示缺失；未声称原生用户会话已复现。初次新增最终指令断言误把附加范围说明当最终指令，改为分别检查两条原有消息；确认mock未声明参数被既有校验拒绝，修正夹具；typecheck不支持findLastIndex，改普通循环，不升级TS配置。
- PASS：`npx vitest run tests/agent/contextOverflowRecovery.test.ts tests/agent/aiChatFlowContext.test.ts tests/agent/modelContextBudget.test.ts tests/agent/agentContextContinuation.test.ts tests/agent/agentExecutionBudget.test.ts tests/agent/agentStreamPrerequisite.test.ts --maxWorkers=1`（6文件73项）。最后补充401/500/文本频率错误排除后，仅重跑前3个实际受影响文件，41/41 PASS；合计覆盖76项，不把两次重复用例相加。
- PASS：`npm run typecheck`；四业务文件及新增测试ESLint（0 error，executor原有两条未使用import warning）；`npm run test:smoke`（2文件8项）；`git diff --check`。未运行全量测试、构建、Rust、发布门禁或独立模型Review。
- 自审：当前diff及真实调用入口核实，没有已确认的本次P0/P1阻断项；知识图detect_changes仅辅助定位，图HEAD不匹配且漏报动态入口测试，不据其test gap否定已执行的生产回归，不重建图。实际结果/源码为准。
- NOT TESTED：新鲜Tauri产物、真实Provider超限条件/恢复效果、原生流式/确认/来源展示。原生暂缓使阶段不能标已完成。建议L2独立验收调用词见本阶段恢复点；建议下一阶段新窗口。

### 2026-10-09｜阶段6本地提交授权

- 用户要求：提交阶段6；只做本地提交，不推送、tag、Release、PR或推进阶段7。
- 精确范围：四业务文件、一个新增超限恢复回归及本计划的阶段6状态/历史；阶段8/9既有追加规划仅留工作区，两个未跟踪目录排除。
- 验证：复用本会话定向回归、typecheck、改动ESLint及Smoke PASS；提交前核查精确暂存清单、计划快照不含阶段8/9追加章节及git diff --cached --check，不重复构建或测试。
- 状态：阶段6仍进行中，真实Provider与原生验收NOT TESTED；提交不等于原生验收完成。

### 2026-10-09｜阶段7搜索边界实施与机器验证

- 状态：进行中；实现与非桌面机器门禁完成，新鲜Tauri Release、安装版差异、原生搜索/选区/阅读位置及新产物启动对照NOT TESTED。阶段1/3/4/5/6暂缓不变，阶段8/9未实施；无提交、推送、tag、Release或PR。
- Blast Radius：MEDIUM→L2。正文真相仍是Tab.content；搜索输入在SearchOverlay，匹配/活动项是绑定当前文档/模式/实际实例/正文的派生快照。直接涉及搜索框、EditorArea实际目标、CodeMirror创建/释放通知、MarkdownPreview模型就绪/搜索补定位及接口；间接覆盖复制/普通选区、ReadingMark、来源定位、阅读恢复与隐藏实例。保存/Store/DB/Rust/权限/AI/RAG、依赖和lazy/prewarm/首屏打点未修改。
- 修改10文件：`src/components/editor/SearchOverlay.tsx`、`CodeMirrorEditor.tsx`、`EditorArea.tsx`、`MarkdownPreview.tsx`、`markdownPreviewTypes.ts`；新增`tests/editor/SearchOverlay.boundary.test.tsx`，调整`SearchOverlay.preview.test.tsx`与`previewTabSwitchRegression.test.tsx`；同步`docs/architecture/state-ownership.md`搜索事实和本计划。5个实际owner、3个直接回归及2份交接/ownership文档均为必要范围，不顺手拆分EditorArea。全部未提交，既有阶段8/9追加内容与两个未跟踪目录保留。
- 实现：CodeMirror实际创建/释放后通知，SearchOverlay以Compartment/ViewPlugin绑定精确view，插件销毁标记失效；doc transaction清掉旧Decoration并使Text对象快照失效，微任务只刷新当前存活binding。预览在模型提交、旧索引清理后通知，Tab正文与displayedContent不一致时暂停，未就绪不扫源码。父级只在搜索打开时触发通知重渲染，不新增首屏搜索扫描。
- 行为：输入/替换文本不依赖remount；初始Ctrl+F请求就绪后仅消费一次，跨文档/模式不重播anchor。自动刷新只计数/高亮，0/N表示未主动选中；第一次上下/Enter按当前光标或视口方向选择，之后循环。显式替换校验当前doc与匹配，单次/全部替换使用新坐标，空/短/长及字面$替换均可用。Diff/无Tab暂停，双预览按来源一起核实。关闭清精确binding；搜索补定位标kind=search，只取消搜索任务/搜索层，不清其他来源定位/ReadingMark/普通选区。
- 失败证据：修改前新正式7项全FAIL，短替换2次Selection越界异常；覆盖真实CodeMirror重建/正文transaction、编辑→预览/换来源、初始未就绪、短/长/空替换。修复后扩展真实EditorArea+虚拟预览双向模式/快速A→B→C/双栏/隐藏Diff/最后Tab关闭、同内容不同文件、设置重建、全部替换、关闭待刷新、空词清理及方向导航。旧诊断7/7只证明异常，不作为修复PASS或安装版证据。
- PASS：`npx vitest run tests/editor/SearchOverlay.boundary.test.tsx tests/editor/SearchOverlay.preview.test.tsx tests/editor/SearchOverlay.nearestMatch.test.ts tests/editor/previewTabSwitchRegression.test.tsx tests/editor/modeResourceLeak.test.tsx --maxWorkers=1`（5文件72 PASS/2既有skip）；最后补空词清理后重跑实际受影响前3文件24/24 PASS，累计73个不同用例，不将重复结果相加。证据`D:\temp\guanmo-stage7-regression.txt`及`guanmo-stage7-search-final.txt`。
- PASS：最终`npm run typecheck`；5业务+3测试ESLint（0 error/8既有Hook warning）；`npm run test:smoke`（2文件8/8）；最终`git diff --check`。未执行全量测试、E2E、构建、Rust、发布门禁或独立模型Review。Smoke仅mock宿主真实React树，不替代原生。
- 修改前同机基线PASS：旧EXE 2026-10-05 18:03:04、25,887,232 bytes，编辑/预览分别`node scripts/measure-cold-start.mjs --runs=3 --surface=edit|preview --keep`；launchToSurface/frontendToSurface/appReady中位数编辑824/295/787ms、预览1033/368/913ms，6个隔离临时目录保留。仅旧产物基线，不宣称性能收益；新产物对照NOT TESTED。若后续变成性能敏感改动，必须按项目各10次新旧Release及中位/P90/max要求补验。
- 夹具/实现修正：旧preview测试handle无searchVisible依赖源码fallback，改为提供真实全文模型投影；jsdom生产pane补scrollTo桩，不改生产滚动兜底。阅读位置断言不固定模型高度变化前的scrollTop（原虚拟布局会校正），直接核实搜索刷新未发scrollTo，并复用全部阅读位置回归。CM destroyed是私有字段，改插件destroy存活标记；不改库/TS配置。自检补空关键词清层回归，diff尾空行已修正。
- 自审：当前diff和实际生命周期/生产入口核实，无已确认本次P0/P1阻断项。知识图仍落后HEAD，detect_changes只辅助定位，不据其漏报测试扩大审查或重建。残余风险：真实安装版双向切换差异、原生焦点/复制/高亮及未挂载块关闭后的迟到滚动、原生新产物启动对照；自动化不能作这些表面的PASS。
- 下一步：用户恢复原生验收时从顶部明确下一步补新鲜Tauri/匿名文档与启动检查；另行指定阶段8后从末尾来源/区块定位计划开始，不重做已提交阶段6或提前改AI/DB。建议L2中等模型独立验收：`使用 ai-code-review Skill 审查阶段7实际diff，重点核实实例重绑、文件/模式/正文失效、替换坐标、清理与阅读位置；复用机器证据，原生维持NOT TESTED，不扫描无关模块。`
- 会话建议：建议新开窗口；下一阶段转入阅读成果来源/区块定位，当前实现、机器证据、失败路线与原生待办完整交接。

### 2026-10-10｜阶段7本地提交授权

- 用户要求：提交阶段7，中文描述详细；仅做本地提交，不执行远程操作或推进阶段8/9。
- 精确范围：5个搜索业务文件、3个直接测试、搜索ownership文档和本计划的阶段7状态/历史，共10文件。计划采用阶段7快照暂存，阶段8/9既有追加章节留在工作区；两个既有未跟踪目录排除并保留。
- 验证：复用本会话定向累计73项、Smoke8/8、typecheck、改动ESLint及diff PASS；提交前核查精确暂存清单、计划快照不含阶段8/9追加章节和git diff --cached --check，不重复运行构建或测试。
- 状态：阶段7仍进行中，新鲜Tauri Release、原生搜索路径与新产物启动对照NOT TESTED；本地提交不代表原生验收完成。
