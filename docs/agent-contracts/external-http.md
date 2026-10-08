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
- 无鉴权更新请求继续使用 `externalFetch`；普通代理拒绝调用方传入鉴权头。既有 Origin 授权、网络地址、重定向、资源限制和流式取消/ACK 保持；操作限额与代理滥用加固另属阶段 4，不能据此宣称已完成。
- 旧 DPAPI 槽位仅在写入绑定记录成功的同一次原子文件更新中删除。旧设置/预设中的明文仅供受控迁移，不进入运行时 Store；其他设置写入前将未迁移项连同原目标保存在可重试的 `legacyApiCredentials` 中，成功后只清除已确认项。缺少目标的旧 Key 保留，不猜测或绑定新 Origin；失败保留原数据并提示重试。
- 旧 DPAPI 槽位缺少可信目标信息，首次绑定必须由 Rust 在非主线程弹出原生确认，展示类型和目标 Origin；前端不能传入确认结果。取消保留旧数据；写入锁内再次核实是否需要确认，避免检查与写入之间的竞态绕过。
- 响应头过滤鉴权/Set-Cookie；原始或 JSON 转义的当前密钥出现在响应中时，Rust 拒绝返回；流式检测跨网络分块保留后缀。此防护不承诺阻止服务方任意编码密钥，也不等于消除 XSS 或代理滥用。
- 桌面构建验证暂缓时可运行 `npm run test:ai-http -- --frontend-only`；仅证明前端适配/IPC/SSE/取消回归。Rust API 与 DPAPI 定向测试、真实本地匿名服务捕获鉴权及新鲜原生产物验收必须单列 `NOT TESTED`；该参数不改变默认完整门禁。
