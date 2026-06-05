# animal-island-ui 组件复用清单

本项目内置了 [animal-island-ui](https://github.com/guokaigdg/animal-island-ui) 的组件快照，来源与授权说明见 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。当前导出的组件包括 `Button`、`Input`、`Switch`、`Modal`、`Card`、`Collapse`、`Divider`、`Select`、`Tabs`、`Table` 等。

## 已复用

- 全局弹窗与表单：`Modal`、`Input`、`Select`、`Switch`、`Tabs`、`Button`
- 侧边栏折叠区与底部控件：`Collapse`、`Button`、`Divider`
- 欢迎页快捷入口：`Card`
- AI 面板基础控件：`Button`、`Switch`、`Divider`
- 命令面板输入框：`Input`

## 后续适合继续替换

- 搜索浮层里的输入框和操作按钮可逐步换成 `Input`、`Button`
- Markdown 代码块预览可评估复用 `CodeBlock`
- 知识库统计或未来模型列表可评估复用 `Table`
- 带勾选的配置项可评估复用 `Checkbox`

## 暂不强行替换

- 文件树、右键菜单、分屏拖拽、命令面板列表目前没有对应导出组件，继续保留项目内轻量实现。
- 如果以后组件库新增 `Tree`、`ContextMenu`、`SplitPane`、`Command`，再按功能闭环逐步替换。
