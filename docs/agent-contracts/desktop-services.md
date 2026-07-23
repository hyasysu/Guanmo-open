# 桌面服务契约

涉及系统壳、应用更新检查或开发模式性能监测时，修改前必须读取本文件。

## 桌面壳命令

- `reveal_file_in_folder(path: string): Result<void, string>`：校验路径已获 `FsAccessState` 授权且文件存在后，调用 Windows 资源管理器定位选中文件。

## 应用更新检查

- 桌面版通过 GitHub Releases `latest` API 检查新版本，当前版本必须由 Tauri `getVersion()` 获取；不接入 Updater 插件或自动安装。
- 启动检查使用 24 小时本地缓存并静默失败，手动检查必须绕过缓存与忽略版本；Release 下载链接只能通过 Tauri 系统浏览器打开。
- 更新版本比较回归使用 `npm run test:update-version`，Toast 去重与暂停计时回归使用 `npm run test:toast`。

## 开发模式性能监测

- 性能监测仅在 Vite 开发模式启用；生产构建不得安装 Timer、RAF、事件监听、Observer 或 Object URL 追踪包装。
- Windows 进程指标统一由 Rust `get_perf_snapshot` 返回，包含 Rust 主进程与每个 WebView2 后代进程的私有内存、CPU、线程和 Handle 明细。
- 默认每 5 秒采样；250/500/1000ms 高精度模式最多运行 60 秒。历史使用容量 300 的环形缓冲区，禁止把完整历史数组放入 React state。
- 报告 schema 当前为 v2；导出保留 v1 内存与 JS Heap 字段别名，读取旧报告时通过 `migratePerfReport` 迁移。
- 报告不得包含完整文件路径、文档/对话内容、凭据或用户名。
- 前端专项回归位于 `tests/performance/`；桌面面板构建验证使用 `npm run build:desktop`。
