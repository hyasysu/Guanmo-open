import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { editorCodeLanguages } from '@/services/editorCodeLanguages'
import { createHeadingId } from '@/services/markdownToc'

const templates = [
  { key: 'heading', name: '标题', text: '## ${标题}' },
  { key: 'table', name: '表格', text: '| ${列一} | ${列二} |\n| --- | --- |\n| ${内容一} | ${内容二} |' },
  { key: 'task', name: '任务列表', text: '- [ ] ${任务}' },
  { key: 'code', name: '代码块', text: '```${语言}\n${代码}\n```' },
  { key: 'link', name: '链接', text: '[${文字}](${地址})' },
  { key: 'image', name: '图片', text: '![${描述}](${地址})' },
  { key: 'quote', name: '引用', text: '> ${引用内容}' },
  { key: 'list', name: '无序列表', text: '- ${内容}' },
]

interface MarkdownNode {
  type: string
  value?: string
  children?: MarkdownNode[]
}

function inside(tree: ReturnType<typeof syntaxTree>, pos: number, names: RegExp): boolean {
  let node = tree.resolveInner(pos, -1)
  while (true) {
    if (names.test(node.name)) return true
    if (!node.parent) return false
    node = node.parent
  }
}

async function headingCompletions(context: CompletionContext, from: number): Promise<CompletionResult | null> {
  context.addEventListener('abort', () => undefined, { onDocChange: true })
  // Heading parsing is loaded only after the user requests a heading link.
  const [{ remark }, { default: remarkGfm }, { default: remarkMath }] = await Promise.all([
    import('remark'), import('remark-gfm'), import('remark-math'),
  ])
  if (context.aborted) return null
  const options: Completion[] = []
  const usedIds = new Map<string, number>()
  const tree = remark().use(remarkGfm, { singleTilde: false }).use(remarkMath).parse(context.state.doc.toString())
  const textOf = (node: MarkdownNode): string =>
    (typeof node.value === 'string' ? node.value : '') +
    (node.children ?? []).map(textOf).join('')
  const walk = (node: MarkdownNode) => {
    if (node.type === 'heading') {
      const text = textOf(node).trim()
      if (!text) return
      options.push({ label: `#${createHeadingId(text, usedIds)}`, displayLabel: text, detail: '当前文档标题', type: 'text' })
    } else {
      for (const child of node.children ?? []) walk(child)
    }
  }
  walk(tree)
  return { from, options, validFor: /^#[^\s)]*$/ }
}

export function markdownCompletionSource(context: CompletionContext): CompletionResult | null | Promise<CompletionResult | null> {
  const { state, pos } = context
  if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return null
  const line = state.doc.lineAt(pos)
  const before = state.sliceDoc(line.from, pos)

  const fence = /^ {0,3}(?:`{3,}|~{3,})([\w+-]*)$/.exec(before)
  const anchor = /(?:^|[^!])\[[^\]\n]*\]\((#[^\s)]*)$/.exec(before)
  const slash = /^ {0,3}\/([^\s/]*)$/.exec(before)
  const explicitBlank = context.explicit && /^ {0,3}$/.test(before) && !line.text.trim()
  if (!fence && !anchor && !slash && !explicitBlank) return null
  const tree = ensureSyntaxTree(state, pos, 20)
  if (!tree) return null
  if (fence && /^ {0,3}(?:`{3,}|~{3,})([\w+-]*)\s*$/.test(line.text)) {
    const node = tree.resolveInner(pos, -1)
    let block = node
    while (block.parent && block.name !== 'FencedCode') block = block.parent
    if (block.name === 'FencedCode' && state.doc.lineAt(block.from).number === line.number) {
      return {
        from: pos - fence[1].length,
        options: editorCodeLanguages.map((language) => ({
          label: language.name === 'JavaScript' ? 'js' : language.alias[0] || language.name.toLowerCase(),
          detail: language.name, type: 'type',
        })),
        validFor: /^[\w+-]*$/,
      }
    }
    return null
  }

  if (inside(tree, pos, /^(FencedCode|CodeBlock|InlineCode|HTMLBlock|CommentBlock)$/)) return null

  if (anchor) {
    return headingCompletions(context, pos - anchor[1].length)
  }

  if (!slash && !explicitBlank) return null
  if (inside(tree, pos, /^(Link|Image)$/)) return null
  const query = slash?.[1].toLowerCase() || ''
  return {
    from: slash ? pos - query.length - 1 : pos,
    filter: false,
    options: templates.filter((item) => item.key.startsWith(query) || item.name.includes(query)).map((item) =>
      snippetCompletion(item.text, { label: `/${item.key}`, displayLabel: item.name, detail: `/${item.key}`, type: 'keyword' })
    ),
  }
}
