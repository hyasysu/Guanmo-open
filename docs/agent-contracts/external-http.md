# 桌面外部 HTTP 契约

涉及对话、Embedding、模型列表、联网搜索、更新检查、自定义 API、本地模型或 Origin 授权时，修改前必须读取本文件。

- 对话、Embedding、模型列表、联网搜索和更新检查统一通过 `src/services/externalHttp.ts` 调用受限 Rust 请求代理，不得直接使用 WebView 原生 `fetch` 或 Tauri HTTP 插件。
- Web 端误调用外部 API 能力时必须抛出 `UnsupportedCapabilityError`，不得回退为浏览器直连。
- Rust 代理只允许 GET/POST，并负责 URL、Origin、DNS/IP、请求头、重定向及资源限额校验；公网只允许 HTTPS，HTTP 仅允许已授权的回环或私网 Origin，危险地址永久拒绝。
- 内置供应商 Origin 自动放行；自定义 API 与本地模型按 `scheme + host + port` 进行本次或永久授权，永久授权保存在应用配置目录并可在设置中撤销。旧 Base URL、模型名和 API Key 保持兼容，首次使用时进入授权流程。
- 流式响应通过 Tauri Channel 转发并保持现有 SSE 解析接口。
- 传输层与授权边界回归使用 `npm run test:ai-http`。
