import { describe, expect, it } from 'vitest'

import { createMarkdownPreviewModel, findAnchorTarget } from '@/services/markdownPreviewModel'

const CONTENT = [
  '# Alpha Section',
  '',
  '[jump](#beta-section)',
  '',
  '```text',
  'id="code-hidden-anchor"',
  '```',
  '',
  '## Beta Section',
  '',
  '<div id="html-target">',
  'html body line',
  '</div>',
  '',
  '## Beta Section',
  '',
  "<span data-kind='single' id='single-quoted-target'>inline</span>",
  '',
  'plain paragraph without anchor',
].join('\n')

describe('findAnchorTarget（模型驱动页内锚点定位）', () => {
  it('heading-{line} 内部标识命中真实标题起始行', () => {
    const model = createMarkdownPreviewModel(CONTENT)
    expect(findAnchorTarget(model, 'heading-1')).toEqual({ line: 1, kind: 'heading-line' })
    expect(findAnchorTarget(model, 'heading-9')).toEqual({ line: 9, kind: 'heading-line' })
  })

  it('heading-{line} 指向非标题行或越界行时不命中', () => {
    const model = createMarkdownPreviewModel(CONTENT)
    expect(findAnchorTarget(model, 'heading-3')).toBeNull()
    expect(findAnchorTarget(model, 'heading-99')).toBeNull()
    expect(findAnchorTarget(model, 'heading-0')).toBeNull()
  })

  it('GitHub 风格标题 slug 命中对应标题块', () => {
    const model = createMarkdownPreviewModel(CONTENT)
    expect(findAnchorTarget(model, 'alpha-section')).toEqual({ line: 1, kind: 'heading-slug' })
    expect(findAnchorTarget(model, 'beta-section')).toEqual({ line: 9, kind: 'heading-slug' })
  })

  it('重复标题按去重后缀解析到第二次出现', () => {
    const model = createMarkdownPreviewModel(CONTENT)
    expect(findAnchorTarget(model, 'beta-section-2')).toEqual({ line: 15, kind: 'heading-slug' })
  })

  it('HTML id 属性命中所在块，行号按块内偏移计算', () => {
    const model = createMarkdownPreviewModel(CONTENT)
    // html 块起始行 11，id 位于首行
    expect(findAnchorTarget(model, 'html-target')).toEqual({ line: 11, kind: 'html-id' })
    // 段落中的内联 HTML：块起始行 17，span 标签与 id 同在首行
    expect(findAnchorTarget(model, 'single-quoted-target')).toEqual({ line: 17, kind: 'html-id' })
  })

  it('多行 HTML 块中 id 位于后续行时返回属性所在行', () => {
    const content = [
      '<div',
      '  class="wrapper"',
      "  id='deep-anchor'>",
      '  body',
      '</div>',
    ].join('\n')
    const model = createMarkdownPreviewModel(content)
    expect(findAnchorTarget(model, 'deep-anchor')).toEqual({ line: 3, kind: 'html-id' })
  })

  it('代码块中的 id 属性不产生锚点目标', () => {
    const model = createMarkdownPreviewModel(CONTENT)
    expect(findAnchorTarget(model, 'code-hidden-anchor')).toBeNull()
  })

  it('frontmatter 中的 id 样式文本不产生锚点目标', () => {
    const content = [
      '---',
      'title: sample',
      'id: "frontmatter-anchor"',
      '---',
      '',
      '# Doc',
    ].join('\n')
    const model = createMarkdownPreviewModel(content)
    expect(findAnchorTarget(model, 'frontmatter-anchor')).toBeNull()
    expect(findAnchorTarget(model, 'doc')).toEqual({ line: 6, kind: 'heading-slug' })
  })

  it('空 id、未知 id 安全返回 null', () => {
    const model = createMarkdownPreviewModel(CONTENT)
    expect(findAnchorTarget(model, '')).toBeNull()
    expect(findAnchorTarget(model, 'does-not-exist')).toBeNull()
  })

  it('文档 95% 位置的远端标题仍可按模型解析', () => {
    const sections = Array.from({ length: 120 }, (_, index) => (
      `## Section ${index + 1}\n\nParagraph ${index + 1} body text.`
    ))
    const content = sections.join('\n\n')
    const model = createMarkdownPreviewModel(content)

    const lastId = `section-120`
    const target = findAnchorTarget(model, lastId)
    expect(target).toEqual({ line: model.toc[119].line, kind: 'heading-slug' })

    // 远端内部标识同样可解析
    const deepLine = model.toc[119].line
    expect(findAnchorTarget(model, `heading-${deepLine}`)).toEqual({
      line: deepLine,
      kind: 'heading-line',
    })
  })
})
