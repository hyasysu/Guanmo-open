# 观墨首屏启动按模式拆包与延迟初始化计划

> 本文件是本任务唯一状态来源。执行者必须使用 `staged-task-handoff` Skill，完整读取后只执行当前阶段，不得提前实施后续阶段。

## 当前状态

- 项目状态：进行中
- 当前阶段：阶段 4｜返修后桌面性能复测
- 阶段状态：阻塞
- 上次执行结果：返修后 ready 回调按活动文档 ID归属；迟到的旧文档预览回调和编辑器 RAF 被拒绝；预览 Tab 切换后 `balanced` / `speed` 恢复预热，`memory` 仍不预热；Fix → Re-review 无 HIGH-confidence P0/P1
- 已知证据：返修后隔离 Release `src-tauri/target-stage4-acceptance/release/guanmo.exe`，24,618,496 bytes，SHA-256 `B0E2A2C10E079491495272916E0A7C276C2C8418A9D052CCE0B1542140E299EC`；Desktop 95 chunks，`EditorArea-hkKOE7lN.js` 72.39 KB、`MarkdownPreview-CifIPx0q.js` 226.34 KB、`InlineMarkdownBlockEditor-B58xGhSW.js` 2.03 KB，bundle 边界通过
- 已知基线：同一当前环境旧 Release 编辑 `frontendToSurface` 中位数/P90/最大值为 493/600/654ms，返修 Release 为 479/510/596ms（中位数改善 2.8%）；旧 Release 预览为 431/508/519ms，返修 Release 为 415/454/489ms（中位数改善 3.7%）
- 验证结果：返修 Release 编辑/预览各取得 10 个有效样本；定向测试 92 passed/2 skipped；typecheck、lint（0 errors）、Desktop build、bundle gate、`git diff --check`、Release 安全校验 9 项通过、0 阻断；Tauri Release 使用 `CARGO_BUILD_JOBS=1` 成功构建
- 未执行项：在磁盘和页面文件充足、WebView2 测量脚本无竞态的干净环境重跑绝对启动目标；当前环境返修编辑中位数 479ms，未达到 ≤400ms
- 本阶段剩余：不改代码；在干净验收环境重跑编辑/预览各 10 次，确认绝对目标或记录环境限制后再关闭阶段
- 本阶段允许修改：仅 `AI_IMPLEMENTATION_PLAN.md`；不得借环境问题扩大代码范围
- 阻塞问题：本机本轮出现页面文件不足（`os error 1455`）、磁盘空间耗尽和 WebView2 临时页面竞态；旧版同环境也高于历史基线，无法将绝对值未达标归因于返修
- 下一阶段：干净环境复测通过后进入交付整理；不重做拆包、不进入 DocumentRange 索引优化
- Git 边界：保留所有既有修改和未跟踪文件；未经明确授权不提交、不推送、不打 tag、不创建 Release

## 项目目标

切断编辑模式对 Markdown 预览实现的启动依赖，使编辑首屏只加载真实编辑器所需代码；预览、双栏预览和差异模式按需加载。真实文档首屏完成后，再初始化隐藏模式预热和非首屏交互能力。在不牺牲 Markdown 语义、DocumentRange、选区、搜索、复制、AI 上下文、预览内编辑和滚动同步正确性的前提下，追回后续预览能力扩展造成的启动回退。

本任务不承诺消除约 0.8s 的原生进程/WebView2 启动底座；`appReady`、AppShell 可见和真实编辑器/预览可见必须分别报告。

## 技术栈

- 运行环境：Tauri 2、Windows、WebView2
- 前端：React 18、TypeScript 5、Vite 6
- 编辑器：CodeMirror 6
- Markdown：ReactMarkdown、remark/rehype、顶层块虚拟化
- 测试：Vitest、React Testing Library、现有启动测量脚本
- 构建：Vite Desktop、Cargo/Tauri Release

## 已确认的根因与边界

1. `src/components/layout/AppLayout.tsx` 已在首个 rAF 后懒加载 `EditorArea`。
2. `EditorArea` 顶层静态导入 `MarkdownPreview`、`MarkdownToc` 和 `MarkdownDiffView`。
3. Desktop 构建中 `MarkdownPreview` 已是约 491 KB 的独立 chunk，但仍是 `EditorArea` 的静态依赖，因此编辑模式必须先请求、解析该 chunk 才能执行 `EditorArea`。
4. `MarkdownToc` 与 `MarkdownPreview` 位于同一文件；编辑模式需要 TOC，不能只把 JSX 条件改成懒加载而保留该导入。
5. 默认 `balanced` 模式会在空闲期预热隐藏模式；拆包后必须确保预热只在真实首屏完成后触发，否则 chunk 会被过早拉取。
6. `createMarkdownPreviewModel` 是真实预览、虚拟化、锚点和全文坐标的必要数据。前两阶段不得为了数字直接延迟它、切换 Worker 或显示伪正文 Skeleton。
7. `perf_monitor` 延迟扫描优化仍在，不属于本次回退根因；SVG HTML 安全链路已经按需加载，不作为本任务修改范围。

## 总体成功标准

- 编辑模式在 `editor-first-visible` 前不请求、不解析 `MarkdownPreview-*.js` 和 `markdownHtml-*.js`。
- `EditorArea-*.js` 的静态 imports 中不再包含 `MarkdownPreview-*.js`。
- 编辑模式 `frontendToSurface` 中位数从约 532ms 降至不高于 400ms，或相对同机新鲜基线至少改善 120ms。
- 编辑模式真实首屏预计改善 0.12–0.25s；该区间是预期，不作为虚假承诺。
- 预览模式 `frontendToSurface` 与 `launchToSurface` 中位数不得比同机新鲜基线恶化超过 10%；P90 不出现新的稳定性退化。
- `appReady`、AppShell 可见、编辑器可见、预览首次可见和预览渲染完成继续保持不同语义。
- 搜索、选区、复制、Ctrl+A、AI 上下文、锚点、目录、滚动同步、预览内编辑、快速切换文档和左右预览不回退。
- 不新增依赖，不放宽 bundle 预算，不用 Skeleton、人工延迟或提前打点制造收益。

## 总体约束

- 每次只执行一个阶段；阶段 1、2 达标后才判断是否需要阶段 3。
- 优先改变模块边界，不在阶段 1 重写 `EditorArea` 或 `MarkdownPreview` 内部架构。
- DOM 仍只是全文模型的渲染结果；搜索、选区、复制和 AI 上下文继续以源码 offset / DocumentRange 为准。
- 动态 import 完成时必须校验当前文档和模式，迟到结果不得恢复旧文档实例或覆盖当前状态。
- Suspense fallback 只保留真实容器背景，不伪造正文；fallback 期间不得上报预览已可见或渲染完成。
- 保留现有模式性能策略语义：`memory` 不预热，`balanced` 智能预热，`speed` 积极预热；只调整首次允许预热的时机。
- 不修改 Tauri/Rust 启动链、数据库、文件权限、RAG、AI 请求、窗口 reveal 和更新检查。
- 未经明确要求不提交、推送、打 tag、创建 Release 或 PR。

## Blast Radius

直接影响：

- `EditorArea` 的静态/动态模块边界
- `MarkdownPreview`、`MarkdownToc`、`MarkdownDiffView` 的加载时机
- 预览首次可见与渲染完成的生命周期标记
- 隐藏模式预热的首次允许时机

间接依赖：

- 编辑、预览、编辑+预览、双栏预览、差异预览
- 快速切换 Tab、模式和左右文档
- 预览 ref、阅读位置、草稿、搜索和高亮注册表
- 更新详情弹窗对 `MarkdownPreview` chunk 的共享引用

高风险点：

- Suspense mount/unmount、ref 可用时机和 cleanup
- 动态 import 无法真正取消，可能产生模式/文档竞态
- 隐藏预热可能在首屏未完成时争抢主线程
- `leftPreviewMounted` 不再等价于预览真实 DOM 已提交，旧打点会提前
- 阶段 3 若触发，会涉及文档模型、缓存失效和全文坐标不变量

禁止影响：

- Tab 内容、Store Source of Truth 和持久化数据
- DocumentRange 坐标、全文搜索域和复制语义
- Markdown 安全渲染与跨块语义
- Web/Desktop 能力边界及现有 bundle 上限

## 阶段计划

### 阶段 1｜按编辑、预览与差异模式拆包

- 目标：编辑模式真实首屏不再被预览 chunk 阻塞。
- 范围：抽离预览类型和 TOC；按模式懒加载预览与差异组件；修正动态加载后的真实可见打点；增加稳定的构建依赖边界检查。
- 验收标准：Desktop 产物中 `EditorArea` 不静态依赖 `MarkdownPreview`；编辑、预览、双栏和差异模式的挂载及打点测试通过。
- 检查命令：定向 EditorArea 生命周期测试、`npm run typecheck`、`npm run lint`、`npm run build:desktop`、bundle 依赖边界检查、`git diff --check`。
- 暂不处理：预热策略时机、`createMarkdownPreviewModel`、DocumentRange 索引延迟、窗口 reveal。

### 阶段 2｜首帧后预热与非首屏能力初始化

- 目标：真实编辑器或预览首屏完成前，不导入隐藏模式和非首屏交互代码。
- 范围：将模式预热门槛绑定到真实活动文档首屏完成 + 现有空闲窗口；按需加载预览内块编辑器；跳过没有搜索/选区状态时的空高亮同步，但不改变注册表恢复语义。
- 验收标准：首屏前无隐藏模式 prewarm-create；用户活动仍可取消预热；`memory/balanced/speed` 语义不变；预览内编辑和高亮生命周期回归通过。
- 检查命令：模式生命周期、资源泄漏、预览切换、预览交互和高亮注册表定向测试，typecheck、lint、desktop build、bundle 检查、`git diff --check`。
- 暂不处理：拆分文档模型或延迟必要的首屏 Markdown 解析。

### 阶段 3｜条件性 DocumentRange 索引延迟

- 进入条件：阶段 1、2 完成后，真实预览首屏仍比同机基线恶化超过 10%，且性能标记证明 `collectTextSegments` / DocumentRange 派生索引是主要相邻耗时；否则本阶段记录为“无需实施”并直接进入阶段 4。
- 目标：保留首屏必需的块、TOC、offset、锚点和虚拟化模型，将仅供搜索、复制与 AI 选区提取的派生索引延迟到首帧后空闲或首次使用。
- 范围：`markdownPreviewModel`、`previewHighlight`、`MarkdownPreview` 及对应契约测试；不得改变源码 offset 坐标系。
- 验收标准：索引只构建一次；用户提前操作时同步补齐；按文档 ID + 内容版本失效；旧异步结果不能覆盖新文档；DOM 卸载不影响全文能力。
- 检查命令：DocumentRange、visible text、selection context、SearchOverlay、预览高亮、快速切换和大文档定向测试，typecheck、lint、desktop build、真实预览测量、`git diff --check`。
- 暂不处理：Worker、并行解析、新依赖、Markdown 渲染器替换。

### 阶段 4｜新鲜 Release 冷启动验收

- 目标：使用当前源码的新鲜隔离 Release 对编辑与预览进行可复现验收，并决定是否达到交付标准。
- 范围：构建和测量；仅修复本任务引入的明确回归，不进入新的优化方向。
- 验收标准：编辑和预览各 10 次冷启动，报告中位数、P90、最大相邻阶段；编辑达到总体成功标准；预览不超过 10% 回退；打点语义和 chunk 请求边界符合预期。
- 检查命令：本任务所有定向测试、typecheck、lint、desktop build/bundle gate、新鲜 Tauri Release 构建、两种 surface 各 10 次测量、`git diff --check`。
- 暂不处理：提交、推送、tag、Release，以及原生/WebView2 的下一轮优化。

## 当前阶段详细任务

### 阶段 3｜进入判断（已完成：无需实施）

#### 目标

先用同机新鲜 Release 数据确认是否存在需要修复的预览首屏回退；证据不足或未超过阈值时不改动 DocumentRange 或文档模型。

#### 允许修改

- `AI_IMPLEMENTATION_PLAN.md`
- 阶段 4 测量所需的既有脚本和临时隔离产物（仅在当前阶段实际需要时）
- `src/services/markdownPreviewModel.ts`、`src/services/previewHighlight.ts`、`src/components/editor/MarkdownPreview.tsx` 及对应契约测试（仅在进入条件满足后）

#### 实施任务

1. 按阶段 4 口径取得同机新鲜 Release 的预览 `frontendToSurface`、`launchToSurface`、中位数、P90 和最大相邻阶段。
2. 只有真实预览首屏回退超过 10%，且性能标记证明 `collectTextSegments` / DocumentRange 派生索引是主要相邻耗时，才进入索引延迟实现。
3. 若条件不满足，将阶段 3 记录为“无需实施”，直接进入阶段 4；若条件满足，另起实现阶段，不在本次判断中提前修改模型。

#### 验收标准

- [x] 完成同机新鲜 Release 预览测量，并记录中位数、P90、最大相邻阶段及与基线的差值。
- [x] 明确记录阶段 3 为“无需实施”：预览 `frontendToSurface` 中位数回退 8.1%，低于 10% 阈值；最大相邻阶段为 `app-ready → active-document-first-visible` 109ms，不是 `collectTextSegments` / DocumentRange 派生索引。
- [x] 未满足进入条件前未修改 `markdownPreviewModel`、`previewHighlight` 或 DocumentRange 派生索引。

#### 检查命令

```powershell
node scripts/pre-push-check.mjs --release
真实隔离 Release 预览冷启动测量（按阶段 4 口径）
git diff --check
```

#### 禁止事项

- 不以单次或非同机测量代替新鲜 Release 数据。
- 不把预期优化当作已验证收益，不在证据不足时改动索引、Worker、并行解析、新依赖或 Markdown 渲染器。
- 不提交、推送、打 tag、创建 Release 或 PR。

### 阶段 4｜新鲜 Release 冷启动验收（已完成）

#### 验收结果

- 新鲜 Release：`src-tauri/target-stage3-release/release/guanmo.exe`，构建时间戳 2026-08-22 21:42:28；前端 95 chunks，bundle gate 通过。首次并行 Rust 构建因 Windows 页面文件不足失败，改用 `CARGO_BUILD_JOBS=1` 复用缓存后成功，不属于源码失败。
- 编辑模式 10 次：`frontendToSurface` 中位数/P90/最大值为 274/316/319ms；`launchToSurface` 为 965/1095/1122ms；最大相邻阶段为 `app-ready → active-document-first-visible` 125ms。编辑中位数低于 400ms 总体标准。
- 预览模式 10 次：`frontendToSurface` 中位数/P90/最大值为 267/273/289ms；`launchToSurface` 为 977/1015/1020ms；最大相邻阶段为 `app-ready → active-document-first-visible` 109ms。
- 相对同机旧 Release 预览基线：`frontendToSurface` 中位数 +20ms（+8.1%）、P90 +7ms（+2.6%）、最大值 +17ms（+6.3%）；`launchToSurface` 中位数 +26ms（+2.7%）、P90 +6ms（+0.6%）、最大值 -30ms（-2.9%）。未超过 10% 回退阈值，P90 未出现稳定性退化。
- 打点语义保持：编辑/预览均分别等待真实 surface 标记与 `app-ready`；阶段 3 未修改首屏必要模型或全文坐标。

#### 检查结果

- [x] `node scripts/pre-push-check.mjs --release`：9 项通过、0 阻断；主分支、脏工作区、已有大文件/Tag 等 6 项警告已保留并记录。
- [x] 阶段 2 定向测试：89 passed、2 skipped。
- [x] `npm run typecheck`、`npm run lint`（0 errors）、`npm run build:desktop`、`npm run check:bundle:desktop`、`git diff --check`。
- [x] 新鲜 Tauri Release 构建及编辑/预览各 10 次隔离冷启动测量。

#### 交付边界

- 本任务代码与验证已完成，但没有提交、推送、打 tag 或创建 Release；新鲜 Release target 和测量日志均作为本地验收产物保留。

## 阶段 2 已完成明细（归档）

### 目标

只完成阶段 2：真实活动文档首屏完成前不创建隐藏模式预热实例，并将预览内块编辑器等非首屏交互代码移出预览首屏模块。

### 允许修改

- `src/components/editor/EditorArea.tsx`
- `src/components/editor/MarkdownPreview.tsx`
- `src/components/editor/InlineMarkdownBlockEditor.tsx`（仅在按需加载边界需要调整导出时）
- `src/services/previewHighlight.ts`（仅在保持注册表恢复语义所必需时；优先不改）
- `tests/editor/EditorArea.resourceLifecycle.test.tsx`
- `tests/editor/modeResourceLeak.test.tsx`
- `tests/editor/previewTabSwitchRegression.test.tsx`
- `tests/markdown/MarkdownPreview.inlineEdit.test.tsx`
- `tests/services/previewHighlightRegistry.test.ts`
- `tests/editor/SearchOverlay.preview.test.tsx`（仅当高亮/搜索入口回归需要）
- `scripts/bundle-budget-check.mjs`（仅增加阶段 2 的稳定依赖边界断言）
- `AI_IMPLEMENTATION_PLAN.md`

### 实施任务

1. 将模式预热的首次调度和实例创建绑定到当前活动文档真实编辑器或预览 DOM 首屏完成；保留现有空闲窗口、用户活动取消、`memory/balanced/speed` 策略和资源生命周期语义。
2. 在文档切换时重置首屏完成状态，迟到的旧文档预热不得创建实例或发出 `prewarm-create`。
3. 将 `InlineMarkdownBlockEditor` 从 `MarkdownPreview` 首屏静态依赖改为交互触发后的动态加载；局部 fallback 只保留编辑区域背景/尺寸，不显示伪正文。
4. 仅在没有搜索/选区状态的普通块挂载同步中跳过空高亮注册；搜索或选区清除路径仍必须显式清除旧 Range，保持注册表恢复和虚拟块重新挂载语义。
5. 增加或更新定向测试，覆盖首屏前无隐藏预热、首屏后按既有策略预热、用户活动取消、内联编辑动态加载及搜索/选区高亮生命周期。
6. 在 Desktop 构建依赖检查中增加稳定断言，确认 `MarkdownPreview` 不静态依赖 `InlineMarkdownBlockEditor`；不通过 bundle 阈值或 `manualChunks` 伪造边界。
7. 完成阶段验证后更新本文件顶部状态与阶段历史；不得提前实施阶段 3 的 DocumentRange 索引延迟。

### 验收标准

- [x] 真实编辑器或预览首屏完成前无隐藏模式 `prewarm-create`；首屏后现有预热目标仍按策略创建。
- [x] 文档切换后旧首屏状态和旧预热调度失效；返修后回调按 documentId 校验，预览 Tab 切换后的 balanced/speed 与 memory 回归通过。
- [x] `InlineMarkdownBlockEditor` 仅在进入预览内编辑后加载，预览普通首屏不静态请求该实现。
- [x] 无搜索/选区状态的普通块挂载不注册空高亮；搜索/选区建立、清除、虚拟块卸载与重新挂载行为不回退。
- [x] 模式生命周期、资源泄漏、预览切换、预览内编辑和高亮注册表定向测试通过。
- [x] typecheck、lint、Desktop build、bundle 依赖边界检查和 `git diff --check` 真实通过。
- [x] 不修改 Store Source of Truth、文档模型、DocumentRange、Markdown 渲染语义和模式性能策略。
- [x] 所有本阶段 Machine Gate 真实通过后，阶段状态才可标记为已完成。

### 检查命令

```powershell
npx vitest run tests/editor/EditorArea.resourceLifecycle.test.tsx tests/editor/modeResourceLeak.test.tsx tests/editor/previewTabSwitchRegression.test.tsx tests/markdown/MarkdownPreview.inlineEdit.test.tsx tests/services/previewHighlightRegistry.test.ts tests/editor/SearchOverlay.preview.test.tsx --maxWorkers=1
npm run typecheck
npm run lint
npm run build:desktop
npm run check:bundle:desktop
git diff --check
```

阶段 2 不要求全量测试、全量 E2E 或 Release 构建；真实冷启动统一在阶段 4 使用新鲜隔离 Release 验收。

### 禁止事项

- 不修改 `createMarkdownPreviewModel`、`markdownPreviewModel.ts` 或 DocumentRange 索引策略。
- 不调整模式预热延迟、资源保留策略或用户设置；只调整首次允许预热的门槛。
- 不通过 `manualChunks`、放宽 bundle 阈值或合并大 chunk 伪造拆包结果。
- 不添加 Skeleton、伪正文或提前打点。
- 不修改窗口 reveal、Rust 启动链、数据库、文件系统、RAG、AI、更新功能或 Markdown 渲染语义。
- 不修改、删除或夹带工作区既有用户文件。
- 不自动提交、推送、打 tag、创建 Release 或 PR。

## 阶段历史

### 阶段 4｜返修后桌面性能复测

- 状态：阻塞
- 完成内容：用返修源码构建隔离 Tauri Release；编辑与预览各取得 10 个有效 WebView2 冷启动样本，并用同一当前环境旧 Release 做对照。
- 测量结果：返修编辑 `frontendToSurface` 为 479/510/596ms，旧版为 493/600/654ms；返修预览为 415/454/489ms，旧版为 431/508/519ms。相对旧版没有性能回退，但编辑绝对中位数仍未达到 400ms。
- 机器检查：Release 构建 PASS（首次并行构建因页面文件不足失败，改用 `CARGO_BUILD_JOBS=1` 成功）；安全校验 9 PASS/0 阻断；定向测试 92 passed/2 skipped；typecheck、lint、Desktop build、bundle gate、`git diff --check` PASS。
- 遗留问题：当前机器资源和测量脚本均出现临时故障，需在干净环境确认绝对性能门槛；未提交、未推送、未打 tag、未创建 Release。

### 验收返修｜文档切换后的首屏就绪时序

- 状态：已完成
- 完成内容：首屏 ready 回调携带并校验当前 documentId；新文档回调先建立 ready 归属，父 effect 不再清零；编辑器 RAF 与预览回调的陈旧结果不能改变当前文档状态；补充预览 Tab 切换后的 balanced/speed 预热恢复、旧 schedule 失效及 memory 不预热回归。
- 本次实测：当前 Release 编辑 `frontendToSurface` 中位数/P90/最大值 351/383/406ms；当前 Release 预览 319/337/419ms；同会话旧 Release 预览 307/350/361ms。当前预览中位数相对旧 Release 回退 3.9%，`launchToSurface` 反而由 1255ms 降至 1158ms；性能验收通过。
- 机器检查：定向 Vitest PASS（92 passed、2 skipped）；`npm run typecheck` PASS；`npm run lint` PASS（0 errors、43 warnings）；`npm run build:desktop` PASS；`npm run check:bundle:desktop` PASS；`git diff --check` PASS；Fix → Re-review PASS。返修后真实 Tauri Release 冷启动数据已在上方“阶段 4｜返修后桌面性能复测”记录，本返修未改变拆包、模型或预热参数。
- 返修边界：只修复活动文档首屏 ready 的归属/时序并补一条切 Tab 后预热回归；不得扩大到预览模型、DocumentRange、渲染语义或启动链。

### 阶段 4｜新鲜 Release 冷启动验收

- 状态：已完成
- 完成内容：使用独立 target 构建当前源码的新鲜 Tauri Release；编辑与预览各完成 10 次隔离 WebView2 冷启动测量。编辑 `frontendToSurface` 中位数/P90/最大值为 274/316/319ms；预览为 267/273/289ms，相对同机旧 Release 预览基线中位数回退 8.1%，低于 10% 阈值。
- 验证结果：Release 安全校验 9 项通过、0 阻断；阶段 2 定向测试 89 passed/2 skipped；typecheck、lint、Desktop build、bundle gate、Release 构建、两种 surface 测量和 `git diff --check` 通过。
- 遗留问题：无；未提交、未推送、未打 tag、未创建 Release。

### 阶段 3｜条件性 DocumentRange 索引延迟

- 状态：已完成（无需实施）
- 完成内容：同机新鲜 Release 预览相对旧 Release 方向性基线的 `frontendToSurface` 中位数回退为 8.1%，未超过 10% 进入阈值；最大相邻阶段为 `app-ready → active-document-first-visible` 109ms，未证明 `collectTextSegments` / DocumentRange 派生索引为主要耗时。
- 验证结果：已完成新鲜 Release 预览测量，并记录中位数、P90、最大相邻阶段及差值；未修改 `markdownPreviewModel`、`previewHighlight` 或 DocumentRange 派生索引。
- 遗留问题：无；未提交、未推送。

### 阶段 2｜首帧后预热与非首屏能力初始化

- 状态：已完成
- 完成内容：模式预热已绑定真实活动文档 editor/preview 首屏回调；预览内块编辑器改为交互触发动态加载；无搜索/选区状态的普通块挂载跳过空高亮同步，显式清除和注册表恢复路径保持不变；补充 Desktop 依赖边界断言和生命周期测试。
- 验证结果：定向测试 6 文件、89 passed、2 skipped；`npm run typecheck`、`npm run lint`（0 errors）、`npm run build:desktop`、`npm run check:bundle:desktop`、`git diff --check` 通过。当前 Desktop 产物 95 chunks，`EditorArea` 约 72.31 KB，`MarkdownPreview` 约 226.34 KB，`InlineMarkdownBlockEditor` 约 2.03 KB 独立 chunk。
- 遗留问题：返修后功能验收通过；阶段 4 仍需在干净环境确认绝对冷启动门槛；未提交、未推送。

### 阶段 1｜按编辑、预览与差异模式拆包

- 状态：已完成
- 完成内容：抽离 `markdownPreviewTypes.ts` 与 `MarkdownToc.tsx`；编辑/预览/差异和更新详情预览按需加载；真实预览 DOM commit 后触发首帧与渲染完成点位；补充依赖边界和生命周期回归。
- 验证结果：定向测试 51 passed、2 skipped；`npm run typecheck`、`npm run lint`、`npm run build:desktop`、`npm run check:bundle:desktop`、`git diff --check` 通过。
- 遗留问题：真实隔离 Release 冷启动测量已在阶段 4 完成；未提交、未推送。

## 新窗口执行提示词

~~~text
请使用 staged-task-handoff Skill，完整读取 AGENTS.md 和 AI_IMPLEMENTATION_PLAN.md，
根据顶部当前状态只执行当前阶段，不重复已完成内容，不提前实施后续阶段。
完成后执行本阶段定向检查，并更新当前状态与阶段历史。
不要提交或推送代码。
~~~
