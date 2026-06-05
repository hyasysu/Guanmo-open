# 观墨 — UI 架构方案

## 1. 整体布局架构

```
┌─────────────────────────────────────────────────────────────────┐
│  Title Bar (Tauri native / custom)                    ─┬─ □ ✕  │
├──────────┬──────────────────────────────┬───────────────┤
│          │                              │               │
│  Sidebar │     Main Editor Area         │   AI Panel    │
│  (260px) │                              │   (360px)     │
│          │  ┌────────────────────────┐  │               │
│  Files   │  │  Tab Bar               │  │  Chat         │
│  Search  │  ├────────────┬───────────┤  │  Context      │
│  Recent  │  │            │           │  │  Agent        │
│  Stars   │  │  Editor    │  Preview  │  │               │
│          │  │  (Code     │  (Render  │  │               │
│          │  │   Mirror)  │   HTML)   │  │               │
│          │  │            │           │  │               │
│          │  └────────────┴───────────┘  │               │
│          │                              │               │
├──────────┴──────────────────────────────┴───────────────┤
│  Status Bar (28px)                                       │
│  [Encoding] [Line/Col] [Word Count] [AI Status] [Sync]  │
└─────────────────────────────────────────────────────────┘
```

### 布局规则

- **左侧边栏**：260px 默认宽度，可折叠至 48px（图标模式）
- **主编辑区**：弹性宽度，支持左右分屏（SplitPane）
- **右侧 AI 面板**：360px 默认宽度，可折叠
- **顶栏标签页**：多标签切换，支持拖拽排序
- **底部状态栏**：28px 固定高度，紧凑信息展示

### 面板层级

| 层级 | 组件 | 背景色 | 说明 |
|------|------|--------|------|
| L0 | 页面画布 | `--gm-canvas` | 最底层背景 |
| L1 | 侧边栏/编辑区/面板 | `--gm-surface` | 主工作区 |
| L2 | 卡片/弹出菜单 | `--gm-surface-elevated` | 浮起一层 |
| L3 | 模态框/下拉 | `--gm-surface-overlay` | 最顶层 |
| Border | 边框 | `--gm-border` | 统一分隔线 |

---

## 2. 色彩系统

### 设计理念

融合 Linear 的极简深色 + Raycast 的表面阶梯 + Cursor 的克制用色。主色调从 animal-island-ui 的青绿色（#19c8b9）出发，适配深色主题后的变体。

### 核心色板

```css
:root {
  /* === Canvas & Surfaces (4-step ladder, inspired by Linear) === */
  --gm-canvas:           #0f1117;   /* 最底层 - 略带蓝调的深黑 */
  --gm-surface:          #161822;   /* L1 - 主工作区 */
  --gm-surface-elevated: #1c1f2e;   /* L2 - 卡片/浮层 */
  --gm-surface-overlay:  #232638;   /* L3 - 模态/下拉 */
  --gm-surface-hover:    #272a3a;   /* 悬停态 */

  /* === Borders (hairline system, inspired by Raycast) === */
  --gm-border:           #2a2d3e;   /* 默认边框 */
  --gm-border-subtle:    #222536;   /* 弱边框 */
  --gm-border-strong:    #3a3d52;   /* 强边框 */
  --gm-border-focus:     #5b8DEF;   /* 焦点边框（主色） */

  /* === Brand Primary (从 animal-island-ui 青绿适配而来) === */
  --gm-primary:          #5b8DEF;   /* 主色 - 柔和蓝紫 */
  --gm-primary-hover:    #7aa5ff;   /* 主色悬停 */
  --gm-primary-active:   #4a7de0;   /* 主色按下 */
  --gm-primary-subtle:   rgba(91, 141, 239, 0.12);  /* 主色弱背景 */

  /* === Accent (AI 功能标识色) === */
  --gm-accent:           #a78bfa;   /* AI/Agent 紫色 */
  --gm-accent-subtle:    rgba(167, 139, 250, 0.12);

  /* === Text Hierarchy === */
  --gm-text:             #e4e6ef;   /* 主文字 - 略带蓝调的亮灰 */
  --gm-text-secondary:   #9498ab;   /* 次要文字 */
  --gm-text-tertiary:    #6b6f82;   /* 辅助文字 */
  --gm-text-disabled:    #4a4e60;   /* 禁用文字 */
  --gm-text-on-primary:  #ffffff;   /* 主色上的文字 */

  /* === Semantic === */
  --gm-success:          #4ade80;
  --gm-warning:          #fbbf24;
  --gm-error:            #f87171;
  --gm-info:             #5b8DEF;

  /* === Editor Specific === */
  --gm-editor-bg:        #0d0f14;   /* 编辑器背景 - 更深 */
  --gm-editor-gutter:    #161822;   /* 行号区域 */
  --gm-editor-line-highlight: rgba(91, 141, 239, 0.06);  /* 当前行高亮 */
  --gm-editor-selection:  rgba(91, 141, 239, 0.20);       /* 选中 */
}
```

### 色彩使用规则

| 用途 | 颜色 | 说明 |
|------|------|------|
| 主 CTA | `--gm-primary` | 蓝紫色，用于核心操作按钮 |
| AI 相关 | `--gm-accent` | 紫色，仅用于 AI 功能标识 |
| 文字主色 | `--gm-text` | 非纯白，略带蓝调 |
| 边框 | `--gm-border` | 1px hairline，不用阴影 |
| 表面层级 | 4-step ladder | 通过色阶而非阴影表达层级 |

---

## 3. 字体排版

### 字体选择

| 用途 | 字体 | 说明 |
|------|------|------|
| UI 文字 | `Inter, 'Noto Sans SC', system-ui` | 从 animal-island-ui 继承中文支持 |
| 编辑器 | `'JetBrains Mono', 'Cascadia Code', monospace` | 代码编辑 |
| Markdown 渲染 | `Inter, 'Noto Sans SC', Georgia, serif` | 阅读模式 |

### 字号阶梯

```css
/* UI Typography Scale */
--gm-font-display:    24px;  /* 面板标题 */
--gm-font-title:      18px;  /* 区域标题 */
--gm-font-body:       14px;  /* 默认正文 - 桌面应用偏小 */
--gm-font-caption:    12px;  /* 辅助说明 */
--gm-font-micro:      11px;  /* 状态栏、行号 */

/* Editor Typography */
--gm-font-editor:     14px;  /* 编辑器字号（可配置） */
--gm-font-preview:    16px;  /* 预览渲染字号 */
--gm-font-line-height: 1.6;  /* 编辑器行高 */
```

### 字重

| 级别 | Weight | 用途 |
|------|--------|------|
| Regular | 400 | 正文、描述 |
| Medium | 500 | 按钮、标签、导航 |
| Semibold | 600 | 标题、强调 |

### 字母间距

- Display/Title：`-0.3px` ~ `-0.5px`（借鉴 Linear 的紧凑感）
- Body/Caption：`0`（默认）
- Caption-uppercase：`+0.5px`（标签类文字）

---

## 4. 间距系统

基于 4px 基础单位，与 Raycast/Linear 一致。

```css
--gm-space-xxs:   2px;
--gm-space-xs:    4px;
--gm-space-sm:    8px;
--gm-space-md:    12px;
--gm-space-lg:    16px;
--gm-space-xl:    24px;
--gm-space-2xl:   32px;
--gm-space-3xl:   48px;
```

### 内边距规范

| 组件 | 内边距 | 说明 |
|------|--------|------|
| 面板容器 | 16px | 侧边栏、AI 面板 |
| 卡片 | 16px | 文件卡片、设置卡片 |
| 按钮 | 8px 14px | 紧凑按钮 |
| 输入框 | 8px 12px | 搜索、表单 |
| 列表项 | 6px 12px | 文件列表行 |
| 菜单项 | 6px 12px | 右键菜单、下拉菜单 |
| 标签页 | 8px 16px | 编辑器标签 |

---

## 5. 视觉层级

### 深度系统（无阴影，纯色阶）

与 Raycast/Linear 一致，**不使用 drop-shadow**，通过表面色阶表达层级。

```
L0  --gm-canvas           #0f1117   页面底层
 │
L1  --gm-surface          #161822   工作区（侧边栏、编辑区）
 │
L2  --gm-surface-elevated #1c1f2e   卡片、输入框
 │
L3  --gm-surface-overlay  #232638   下拉菜单、弹窗
 │
L4  模态遮罩              rgba(0,0,0,0.6)  全屏模态
```

### 边框层级

| 级别 | 颜色 | 用途 |
|------|------|------|
| Subtle | `--gm-border-subtle` | 面板间分隔 |
| Default | `--gm-border` | 卡片边框、输入框 |
| Strong | `--gm-border-strong` | 激活态边框 |
| Focus | `--gm-border-focus` | 键盘焦点环 |

---

## 6. 组件风格指南

### animal-island-ui 适配策略

animal-island-ui 的原始风格是暖色调、圆角大（16-24px）、轻快的动物森友会风格。观墨需要将其转化为深色生产力工具风格：

| 原始属性 | 适配后 | 说明 |
|----------|--------|------|
| 圆角 16-24px | 圆角 6-10px | 减小圆角，更专业 |
| 暖色背景 `#f8f8f0` | 深色背景 `#161822` | 完全反转主题 |
| 棕色文字 `#794f27` | 浅灰文字 `#e4e6ef` | 适配深色底 |
| 青绿主色 `#19c8b9` | 蓝紫主色 `#5b8DEF` | 更适合深色工具 |
| 大阴影 | 无阴影，纯色阶 | 借鉴 Linear/Raycast |
| 装饰性分隔线 | 1px hairline | 简洁边框 |

### 复用组件清单

| animal-island-ui 组件 | 观墨用途 | 需要的适配 |
|-----------------------|----------|------------|
| `Button` | 所有操作按钮 | 深色主题 + 减小圆角 |
| `Input` | 搜索、表单输入 | 深色主题适配 |
| `Select` | 设置下拉选择 | 深色主题适配 |
| `Checkbox` | 设置选项 | 深色主题适配 |
| `Switch` | 设置开关 | 深色主题适配 |
| `Tabs` | 编辑器多标签 | 深色主题 + 去掉叶子动画 |
| `Modal` | 设置对话框 | 深色主题 + 去掉 blob clipPath |
| `Table` | 设置列表 | 深色主题适配 |
| `ScrollArea` | 所有滚动区域 | 深色滚动条样式 |
| `Card` | 设置卡片 | 深色主题适配 |
| `Icon` | 功能图标 | 可直接复用 |
| `Loading` | 加载动画 | 可直接复用 |

### 需要新建的组件

| 组件 | 说明 | 原因 |
|------|------|------|
| `Sidebar` | 可折叠侧边栏 | animal-island-ui 没有 |
| `SplitPane` | 可拖拽分屏 | animal-island-ui 没有 |
| `Tree` | 文件树 | animal-island-ui 没有 |
| `ContextMenu` | 右键菜单 | animal-island-ui 没有 |
| `Command` | 命令面板 (Ctrl+P) | animal-island-ui 没有 |
| `Tooltip` | 工具提示 | animal-island-ui 没有 |
| `Drawer` | 侧边抽屉 | animal-island-ui 没有 |
| `StatusBar` | 底部状态栏 | 需要定制 |
| `TabBar` | 编辑器标签栏 | 需要深度定制 |
| `Editor` | Markdown 编辑器 | 核心功能，需集成 CodeMirror |
| `ChatPanel` | AI 对话面板 | 核心功能 |
| `FileTree` | 文件树组件 | 基于 Tree 扩展 |

---

## 7. 动效规范

### 基础参数

```css
--gm-duration-fast:     120ms;
--gm-duration-base:     200ms;
--gm-duration-slow:     300ms;
--gm-ease-default:      cubic-bezier(0.4, 0, 0.2, 1);
--gm-ease-in:           cubic-bezier(0.4, 0, 1, 1);
--gm-ease-out:          cubic-bezier(0, 0, 0.2, 1);
```

### 动效场景

| 场景 | 时长 | 缓动 | 说明 |
|------|------|------|------|
| 按钮悬停 | 120ms | default | 背景色渐变 |
| 侧边栏折叠 | 200ms | ease-out | 宽度动画 |
| 面板展开 | 200ms | ease-out | AI 面板滑入 |
| 模态框出现 | 200ms | ease-out | fade + slight scale |
| 标签页切换 | 120ms | default | 内容切换 |
| 搜索高亮 | 120ms | default | 匹配项闪烁 |
| Toast 提示 | 300ms | ease-out | 底部滑入 |
| 拖拽分屏 | 实时 | - | 无动画，即时响应 |

### 微动效原则

- **克制**：不使用弹跳、旋转等装饰性动画
- **快速**：所有交互反馈 ≤ 200ms
- **有意义**：动效仅用于引导注意力和反馈状态
- **不阻塞**：动画不阻止用户操作

---

## 8. 主题系统

当前仅实现深色主题。架构上保留主题切换能力：

```
styles/
  tokens/
    dark.css          -- 深色主题变量（默认）
    light.css         -- 浅色主题变量（预留）
  global.css          -- 全局基础样式
  components/         -- 各组件样式
```

主题切换通过 `data-theme="dark|light"` 属性控制 CSS 变量覆盖。

---

## 9. 响应式策略

Tauri 桌面应用不涉及移动端，但需要处理窗口大小变化：

| 窗口宽度 | 侧边栏 | AI 面板 | 编辑区 |
|----------|--------|---------|--------|
| ≥ 1440px | 260px | 360px | 弹性 |
| 1024-1439px | 220px | 320px | 弹性 |
| 768-1023px | 48px (图标) | 抽屉模式 | 弹性 |
| < 768px | 隐藏 | 隐藏 | 全屏 |

---

## 10. 关键设计决策总结

1. **无阴影设计**：借鉴 Linear/Raycast，通过 4 级色阶表达层级，不使用 drop-shadow
2. **1px hairline 边框**：所有卡片和面板使用细边框分隔
3. **蓝紫主色**：深色背景下的高对比度主色，兼顾可读性和品牌辨识度
4. **紧凑信息密度**：桌面生产力工具的默认字号 14px，间距偏紧凑
5. **AI 紫色标识**：AI 相关功能统一使用紫色系，与主色区分
6. **编辑器沉浸感**：编辑区背景比通用背景更深，减少视觉干扰
7. **组件库深度适配**：保留 animal-island-ui 的组件逻辑，覆盖其视觉主题
