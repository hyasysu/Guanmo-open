# Trellis 项目约束

只有当前用户消息明确要求 Trellis、创建 Trellis 任务或具体 `trellis-*` 工作流时才读取和执行本文件。

- Trellis 采用显式启用；普通开发、修复、检查、提交和会话启动不得自动调用，不得自动创建、启动或归档任务，也不得自动加载 Trellis 上下文。历史授权不跨消息继承。
- 本仓库已初始化 Trellis，核心目录为 `.trellis/`，Codex 集成目录为 `.codex/`，共享技能目录为 `.agents/skills/`。
- Trellis 版本记录在 `.trellis/.version`；项目配置入口为 `.trellis/config.yaml`，工作流入口为 `.trellis/workflow.md`。
- 本项目不注册自动 Trellis 钩子；用户明确要求后，由对应技能按需加载工作流上下文。
- `.trellis/.developer`、`.trellis/.runtime/` 等运行态数据按 `.trellis/.gitignore` 保持本地，不作为项目代码提交。
