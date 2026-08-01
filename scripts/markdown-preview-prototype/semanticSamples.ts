/**
 * 阶段2原型：语义完整性样本集（匿名，不包含真实用户数据）
 *
 * 每个样本都导出 { name, markdown, assertions }，
 * assertions 描述 createMarkdownPreviewModel() 必须满足的不变式。
 * 这些样本同时被 A/B 基准脚本与定向单元测试复用。
 */

import type { MarkdownPreviewModel } from '@/services/markdownPreviewModel'

export interface SemanticSample {
  name: string
  markdown: string
  /**
   * 返回断言失败消息列表；空数组表示全部通过。
   * 不使用第三方断言库，避免新增依赖。
   */
  assertions: (model: MarkdownPreviewModel) => string[]
}

const FAIL = (reason: string) => reason

export const SEMANTIC_SAMPLES: SemanticSample[] = [
  {
    name: 'frontmatter + 多级标题',
    markdown: [
      '---',
      'title: 匿名样本标题',
      'tags: [alpha, beta]',
      '---',
      '',
      '# 第一章 概述',
      '',
      '这是普通段落，包含中文与 English mixed 内容。',
      '',
      '## 1.1 小节',
      '',
      '子段落。',
      '',
      '### 1.1.1 细目',
      '',
      '嵌套细节。',
      '',
      '# 第二章 重复标题',
      '',
      '重复标题用于验证 heading ID 去重。',
      '',
      '## 1.1 小节',
      '',
      '与前面小节同名。',
    ].join('\n'),
    assertions: (m) => {
      const errs: string[] = []
      if (m.blocks[0]?.type !== 'frontmatter') return [FAIL('首块应为 frontmatter')]
      const headings = m.blocks.filter((b) => b.type === 'heading')
      if (headings.length < 5) return [FAIL(`标题数量不足，实际 ${headings.length}`)]
      const ids = headings.map((h) => h.heading?.id).filter(Boolean) as string[]
      const unique = new Set(ids)
      if (unique.size !== ids.length) errs.push(FAIL(`heading id 重复: ${ids.join(', ')}`))
      if (m.toc.length !== headings.length) errs.push(FAIL(`toc 长度 ${m.toc.length} != 标题数 ${headings.length}`))
      // 首块 offset 边界
      const fm = m.blocks[0]
      if (fm.startOffset !== 0 || fm.endOffset <= fm.startOffset) {
        errs.push(FAIL('frontmatter offset 非法'))
      }
      return errs
    },
  },
  {
    name: 'GFM 表格 + 任务列表 + 嵌套列表',
    markdown: [
      '| 项目 | 描述 | 优先级 |',
      '| --- | --- | --- |',
      '| A | 样本项 A | 高 |',
      '| B | 样本项 B | 中 |',
      '| C | 样本项 C | 低 |',
      '',
      '## 任务清单',
      '',
      '- [x] 已完成事项一',
      '- [ ] 未完成事项二',
      '  - 嵌套无序列表项',
      '  - 嵌套第二项',
      '    1. 嵌套有序列表一',
      '    2. 嵌套有序列表二',
      '- [x] 已完成事项三',
      '',
      '1. 顶层有序 A',
      '2. 顶层有序 B',
      '   - 无序子项 X',
      '   - 无序子项 Y',
      '3. 顶层有序 C',
    ].join('\n'),
    assertions: (m) => {
      const errs: string[] = []
      const table = m.blocks.find((b) => b.type === 'table')
      if (!table) errs.push(FAIL('缺少 table 块'))
      else if (!table.tableMeta) errs.push(FAIL('table 缺少 meta'))
      // 注意：MarkdownPreviewModel 只提取顶层块，嵌套 list 保留在父 list 的 rawSource 中。
      // 这里验证：至少存在 2 个顶层 list（任务清单 + 顶层有序），且 rawSource 中能看到嵌套结构。
      const lists = m.blocks.filter((b) => b.type === 'list')
      if (lists.length < 2) errs.push(FAIL(`顶层列表数量不足 ${lists.length}`))
      const combined = lists.map((l) => l.rawSource).join('\n')
      // 嵌套无序列表 / 嵌套有序列表 / 无序子项 至少出现两次嵌套层
      const nestedUl = /(^|\n)\s{2,}-\s+/.test(combined)
      const nestedOl = /(^|\n)\s{4,}\d+\.\s+/.test(combined)
      if (!nestedUl) errs.push(FAIL('rawSource 未包含嵌套无序列表'))
      if (!nestedOl) errs.push(FAIL('rawSource 未包含嵌套有序列表'))
      // 任务列表块应保留原始 source，供行号使用
      const taskList = lists.find((l) => /\[.\]/.test(l.rawSource))
      if (!taskList) errs.push(FAIL('缺少任务列表 source'))
      return errs
    },
  },
  {
    name: '代码块 + 超长代码 + Mermaid',
    markdown: [
      '```typescript',
      'function fib(n: number): number {',
      '  if (n < 2) return n',
      '  return fib(n - 1) + fib(n - 2)',
      '}',
      '',
      '// 匿名注释',
      'export const SAMPLE = Array.from({ length: 10 }, (_, i) => fib(i))',
      '```',
      '',
      '```mermaid',
      'graph TD',
      '  A[样本输入] --> B{处理}',
      '  B -->|是| C[输出 OK]',
      '  B -->|否| D[输出 FAIL]',
      '```',
      '',
      '```python',
      'def big():\n    return """' + '\nline '.repeat(120) + '\n    """',
      '```',
    ].join('\n'),
    assertions: (m) => {
      const errs: string[] = []
      const codeBlocks = m.blocks.filter((b) => b.type === 'code')
      const mermaidBlocks = m.blocks.filter((b) => b.type === 'mermaid')
      if (codeBlocks.length < 2) errs.push(FAIL(`code 块数量不足 ${codeBlocks.length}`))
      if (mermaidBlocks.length !== 1) errs.push(FAIL(`mermaid 块数量应为 1，实际 ${mermaidBlocks.length}`))
      const bigCode = codeBlocks.find((b) => b.codeMeta && b.codeMeta.lines >= 80)
      if (!bigCode) errs.push(FAIL('应存在行数较多的 code 块'))
      // 保留 startOffset/endOffset
      for (const b of [...codeBlocks, ...mermaidBlocks]) {
        if (!(b.endOffset > b.startOffset)) errs.push(FAIL(`${b.type} offset 非法`))
      }
      return errs
    },
  },
  {
    name: '行内 KaTeX + 块级数学 + \\[\\] 定界符',
    markdown: [
      '质能方程为 $E = mc^2$，其中 $m$ 是质量。',
      '',
      '$$',
      '\\\\int_{0}^{1} x^2 \\\\, dx = \\\\frac{1}{3}',
      '$$',
      '',
      '\\[',
      '\\\\sum_{i=1}^{n} i = \\\\frac{n(n+1)}{2}',
      '\\]',
    ].join('\n'),
    assertions: (m) => {
      const errs: string[] = []
      const maths = m.blocks.filter((b) => b.type === 'math')
      // 规范化后 \[...\] 与 $$...$$ 都应识别为 math 块
      if (maths.length < 2) errs.push(FAIL(`块级数学数量应为 >=2，实际 ${maths.length}`))
      return errs
    },
  },
  {
    name: '跨块 reference link/definition + footnote 跨块',
    markdown: [
      '在 [首个链接][alpha] 与 [次链接][beta] 之间有段落。',
      '',
      '第二段引用 [alpha] 与脚注 [^first]。',
      '',
      '第三段引用脚注 [^second]。',
      '',
      '[alpha]: https://example.test/alpha "Alpha Title"',
      '[beta]: https://example.test/beta',
      '',
      '[^first]: 这是第一个脚注的定义，可能很长。',
      '',
      '[^second]: 第二个脚注定义，',
      '   可能跨越多行原始 Markdown。',
    ].join('\n'),
    assertions: (m) => {
      const errs: string[] = []
      const alpha = m.definitions.find((d) => d.identifier === 'alpha')
      const beta = m.definitions.find((d) => d.identifier === 'beta')
      if (!alpha || !beta) errs.push(FAIL(`reference definitions 缺失：alpha=${Boolean(alpha)}, beta=${Boolean(beta)}`))
      if (alpha && !alpha.title) errs.push(FAIL('alpha title 应保留'))
      const fns = m.footnoteDefinitions
      if (fns.length < 2) errs.push(FAIL(`footnote defs 数量应为 >=2，实际 ${fns.length}`))
      const first = fns.find((f) => f.identifier === 'first')
      const second = fns.find((f) => f.identifier === 'second')
      if (!first || !second) errs.push(FAIL('footnote identifier 未解析'))
      return errs
    },
  },
  {
    name: '安全内嵌 HTML details/summary + 图片',
    markdown: [
      '<details>',
      '<summary>展开查看细节</summary>',
      '',
      '折叠区域内的普通 Markdown **段落**。',
      '',
      '</details>',
      '',
      '![匿名示意图](https://example.test/image.png "图片标题")',
      '',
      '![本地图片](./assets/sample.png)',
    ].join('\n'),
    assertions: (m) => {
      const errs: string[] = []
      const html = m.blocks.find((b) => b.type === 'html')
      if (!html) errs.push(FAIL('缺少 html 块（details）'))
      const images = m.blocks.filter((b) => b.type === 'image')
      if (images.length < 2) errs.push(FAIL(`图片块数量不足，实际 ${images.length}`))
      return errs
    },
  },
  {
    name: '空文档 + 单一巨大段落块',
    markdown: '',
    assertions: (m) => {
      // 空文档的 blocks 必须为空数组（避免渲染零高度占位）
      if (m.blocks.length !== 0) return [FAIL(`空文档 block 数应为 0，实际 ${m.blocks.length}`)]
      if (m.toc.length !== 0) return [FAIL('空文档 toc 应为空')]
      return []
    },
  },
  {
    name: '单一巨大段落块',
    markdown: '这是一整个没有换行的超级长段落，' + '内容重复填充。'.repeat(400),
    assertions: (m) => {
      if (m.blocks.length === 0) return [FAIL('单块文档至少应有 1 个块')]
      const p = m.blocks.find((b) => b.type === 'paragraph')
      if (!p) return [FAIL('应有 paragraph 块')]
      if (p.rawSource.length < 1000) return [FAIL('块 source 应保留较长内容')]
      return []
    },
  },
  {
    name: '中文/英文混合 + CRLF 行尾 + 引用块',
    markdown:
      [
        '> 引用块第一行（中文）',
        '> 引用块第二行（English）',
        '',
        '正文段：中文字符与 ASCII 1234567890 混合。',
        '',
        '---',
        '',
        '分隔线后段落。',
      ].join('\r\n'),
    assertions: (m) => {
      const errs: string[] = []
      const quote = m.blocks.find((b) => b.type === 'blockquote')
      if (!quote) errs.push(FAIL('缺少 blockquote'))
      const hr = m.blocks.find((b) => b.type === 'thematicBreak')
      if (!hr) errs.push(FAIL('缺少 thematicBreak'))
      return errs
    },
  },
]
