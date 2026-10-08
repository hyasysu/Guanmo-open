# 外部 HTTP 契约

涉及对话、Embedding、模型列表、联网搜索、更新检查、自定义 API、本地模型或 Origin 授权时，修改前必须读取本文件。

- 桌面对话、Embedding、模型列表、联网搜索和更新检查统一通过 `src/services/externalHttp.ts` 调用受限 Rust 请求代理，不得直接使用 WebView 原生 `fetch` 或 Tauri HTTP 插件。
- Web 端只有 OpenAI-compatible Chat Completions 可经 `src/web/webAiClient.ts` 使用浏览器 `fetch`；不得让桌面入口或其他共享服务回退到浏览器直连。公网 API 只允许 HTTPS，本机回环地址允许 HTTP，浏览器跨域策略仍是实际可用边界。
- Web 设置区只开放对话 API 与联网搜索 API，Embedding 保持禁用。两类 API Key 默认只保存在当前页面内存；用户可在明确风险弹窗确认后将其明文保存到 LocalStorage，或用同一个本地密码派生不可导出的 AES-GCM 密钥，将带随机 salt/IV 的双 Key 密文保存到 LocalStorage。加密模式的密码、派生密钥、明文 Key，以及所有模式的对话和文档授权不得持久化，也不得写入 SessionStorage、IndexedDB、URL、日志或错误信息；文档正文默认不发送，必须由用户逐页明确勾选。
- Web 端误调用 Embedding、更新检查、RAG 或 API Origin 持久授权时必须抛出 `UnsupportedCapabilityError`。
- Rust 代理只允许 GET/POST，并负责 URL、Origin、DNS/IP、请求头、重定向及资源限额校验；公网只允许 HTTPS，HTTP 仅允许已授权的回环或私网 Origin，危险地址永久拒绝。
- 内置供应商 Origin 自动放行；自定义 API 与本地模型按 `scheme + host + port` 进行本次或永久授权，永久授权保存在应用配置目录并可在设置中撤销。旧 Base URL、模型名和 API Key 保持兼容，首次使用时进入授权流程。
- 流式响应通过 Tauri Channel 转发并保持现有 SSE 解析接口。
- 传输层与授权边界回归使用 `npm run test:ai-http`。

## 桌面密钥与配置身份

- `configure_api_connection({connection: {kind, protocol, baseUrl}, value?, remove?, migrateLegacy?, importLegacy?})` 只返回 `{configId, configured}`；留空保持现有 Key，`remove: true` 显式删除，`importLegacy: true` 仅在绑定记录尚未配置 Key 时导入旧明文，不覆盖新保存的 Key。Windows 继续使用现有 `secrets.json` 与 DPAPI，其他平台不允许明文回退。配置身份由 Rust 按类型、协议和规范化地址生成；不同目标和不同密钥类型不会共用 Key，同一目标的预设/模型共用该连接。
- 桌面 Store 只保存密钥状态和运行时版本，输入只在设置控件及一次写入调用中短暂存在；成功后清除输入，不提供已保存 Key 的读取、查看或复制接口。`load_secret/save_secret/delete_secret` 不再注册到 IPC。
- 凭据请求经 `externalApiFetch` 传 `{configId, operation, query?, count?}`、业务体、超时及 requestId；请求中 URL、method、headers 必须为空。Rust 从绑定记录生成目标、方法和鉴权头，不接受另一目标或头覆盖。聊天和模型列表仅支持现行 OpenAI Chat；Embedding 使用独立配置；搜索按 Tavily/Serper/Brave/自定义协议生成鉴权。未实现的 Anthropic Messages/Responses 继续明确拒绝。
- 无鉴权更新请求继续使用 `externalFetch`；普通代理仅允许本仓库 GitHub Releases 的 `GET latest` / `GET tags/v<版本>`，无请求体，只接受 Accept、User-Agent、X-GitHub-Api-Version、If-None-Match。其他业务入口必须走绑定操作，Origin 授权不能将普通代理变成任意路径代理。
- 旧 DPAPI 槽位仅在写入绑定记录成功的同一次原子文件更新中删除。旧设置/预设中的明文仅供受控迁移，不进入运行时 Store；其他设置写入前将未迁移项连同原目标保存在可重试的 `legacyApiCredentials` 中，成功后只清除已确认项。缺少目标的旧 Key 保留，不猜测或绑定新 Origin；失败保留原数据并提示重试。
- 旧 DPAPI 槽位缺少可信目标信息，首次绑定必须由 Rust 在非主线程弹出原生确认，展示类型和目标 Origin；前端不能传入确认结果。取消保留旧数据；写入锁内再次核实是否需要确认，避免检查与写入之间的竞态绕过。
- 响应头过滤鉴权/Set-Cookie；原始或 JSON 转义的当前密钥出现在响应中时，Rust 拒绝返回；流式检测跨网络分块保留后缀。此防护不承诺阻止服务方任意编码密钥，也不等于消除 XSS 或代理滥用。
- 桌面构建验证暂缓时可运行 `npm run test:ai-http -- --frontend-only`；仅证明前端适配/IPC/SSE/取消回归。Rust API 与 DPAPI 定向测试、真实本地匿名服务捕获鉴权及新鲜原生产物验收必须单列 `NOT TESTED`；该参数不改变默认完整门禁。

## Rust 操作与会话限额

- Rust 决定配置类型/协议/操作对应的精确方法和端点。未实现协议拒绝，绑定请求不能传 URL、方法、头或未知字段；配置路径拒绝点段、反斜线、编码的分隔符/点/嵌套百分号/控制字符，安全的空格和 Unicode 路径编码保持兼容。自定义服务仍按既有 Origin 授权，凭据不能跨目标复用。GET 搜索查询最多8192字节，结果数1至100条。
- 使用计数由 `ApiOriginState` 内唯一 Mutex 保护：每配置滑动60秒最多120次、全应用最多240次；整个应用进程会话最多10000次请求与512 MiB响应。配置切换、Key 替换、授权撤销、请求取消/失败均不重置或退还计数；每次实际重试重新计数。未授权请求不计数，授权后重试才计数；请求在入队前计数，响应按收到的网络字节计数，含错误响应与取消前已收到的字节。
- `RATE_LIMIT_EXCEEDED` 明确要求稍后重试；`SESSION_LIMIT_EXCEEDED` 明确说明当前会话上限。前端不对这些错误自动发起授权/参数回退；Embedding 批量和逐条降级遇限额立即抛出，不继续批次内重试，已有队列记录失败状态。无用户可调整阈值、无跨重启日累计存储；重启会重置会话计数，不能宣传为跨重启预算或供应商消费硬上限。
- 保留单请求2 MiB输入、16 MiB响应和并发8；最长120秒覆盖排队、DNS/网络、响应读取及流式ACK等待，超时/取消后释放并发许可和注册表。重复的活动requestId拒绝，取消不提前释放其身份，避免旧清理删除新请求。累计响应达到上限后，已排队请求不得继续发出。
- 字节边界仅限制本地接收/转发，不能保证供应商停止计费，也不将响应字节换算成token或金额；供应商硬消费上限仍需在供应商后台设置。独立 `rustc --test src-tauri/src/api_http_limits.rs` 只验证纯计数策略，不替代 Tauri 代理的编译、定向测试或真实网络验收。
