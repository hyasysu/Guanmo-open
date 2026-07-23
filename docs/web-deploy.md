# 网页版部署流程

本文件是项目代理共用的 Web 能力边界、构建和部署参考。涉及推送时必须先遵守 `AGENTS.md` 与 `docs/push-safety.md` 的校验和二次确认，本文中的命令示例不构成执行授权。

## 能力与构建边界

- Web 端必须提供基础阅读功能，不得用“完整功能仅在桌面端提供”等整页弹窗或下载页阻断阅读体验；Web 端仅禁用文件管理、数据库和 AI（含 RAG），共享层误调用受限能力时必须抛出 `UnsupportedCapabilityError`。
- `npm run build` 生成 Web 裁剪版；`npm run build:desktop` 生成 Tauri 桌面前端。Tauri 配置必须调用 desktop 命令，不得混用 Web 入口。
- 两种构建分别执行模式校验与体积预算；可单独运行 `npm run check:bundle:web` 或 `npm run check:bundle:desktop`，Web 产物不得包含桌面模块、字体或桌面资源。

## 仓库说明

- **网页版源码仓库**：即当前开源仓库 `D:\React\guanmo-open`，在此处执行 `npm run build`（Vite）打包
- **网页版部署仓库**：`D:\React\guanmo-page`，用于放置打包好的网页版静态资源，通过 GitHub Pages 自动部署

## 更新网页版流程

1. 在当前开源仓库 `D:\React\guanmo-open` 执行 `npm run build`，产出在 `dist/` 目录
2. 将 `dist/` 内的打包资源复制到网页版部署仓库 `D:\React\guanmo-page`
3. 在 `D:\React\guanmo-page` 中执行 `git add -A && git commit && git push`，交由 GitHub 自动部署更新
