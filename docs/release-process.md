# 发布流程

本文件是项目代理共用的发布流程详细参考。所有推送、tag 和 Release 操作必须先遵守 `AGENTS.md` 与 `docs/push-safety.md` 的校验和二次确认，本文中的命令示例不构成执行授权。

## 1. 发布前准备

### 1.1 统一更新版本号

确保以下所有文件中的版本号一致，统一修改为新版本号 `X.Y.Z`：

| 文件 | 字段/位置 |
|------|----------|
| `package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| `README.md` | 徽章/版本引用（如有） |
| `CHANGELOG.md` | 新版本标题 |

### 1.2 安全检查：审计最近一个 tag 之后的全部 commit

```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline
```

逐条检查每个 commit：
- **敏感信息泄漏**：token、key、secret、password、内网地址、内部 IP、数据库连接串
- **开源安全合规**：是否违反开源许可证、是否包含未授权的第三方私有代码
- 如发现问题，**必须先修复再继续发布流程**

### 1.3 生成 Release Notes

基于最近一个 tag 之后的所有 commit，按以下分类整理：

| 分类 | 前缀/关键词 | 说明 |
|------|------------|------|
| 🆕 新功能 | `feat:` / `新增` / `添加` | 新增的功能特性 |
| 🐛 修复 | `fix:` / `修复` / `修正` | Bug 修复 |
| 🔄 重构 | `refactor:` / `重构` | 代码重构，无功能变化 |
| ⚡ 优化 | `perf:` / `优化` / `改进` | 性能优化或体验改进 |
| 🔧 构建 | `build:` / `chore:` / `构建` / `依赖` | 构建系统、依赖、CI 变更 |

生成格式：

```markdown
## 🆕 新功能
- xxx

## 🐛 修复
- xxx

## 🔄 重构
- xxx

## ⚡ 优化
- xxx

## 🔧 构建
- xxx
```

## 2. 执行发布

### 2.1 提交版本号变更

```bash
git add package.json src-tauri/tauri.conf.json README.md CHANGELOG.md
git commit -m "chore: 发布 vX.Y.Z"
```

### 2.2 创建并推送 tag

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

> Tag 推送后，GitHub Actions（`.github/workflows/release.yml`）会自动触发 Tauri 构建，产出 Windows 安装包并发布 GitHub Release。

### 2.3 将 Release Notes 写入 GitHub Release 描述

在 GitHub Release 页面（或通过 `gh release edit vX.Y.Z --notes "..."`），将 Release Notes 填入发布描述。

## 3. 发布后验证

- [ ] GitHub Actions 构建通过（无报错）
- [ ] Release 页面包含正确的安装包附件（`.msi` / `.exe`）
- [ ] Release 描述包含完整的 release notes
- [ ] `git tag` 可看到新版本 tag

## 4. 最终输出

```
✅ 发布完成
- 新版本号：vX.Y.Z
- Release Notes：（摘要或完整内容）
- 发布状态：构建成功 / 待确认
- GitHub Release URL：https://github.com/we-used-to-be/Guanmo-open/releases/tag/vX.Y.Z
```
