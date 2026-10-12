import { describe, expect, it } from 'vitest'
import { ECHARTS_MAX_SOURCE_LENGTH, parseEChartsOption } from '@/services/echartsOption'

describe('ECharts Markdown 配置解析', () => {
  it('接受严格 JSON 的常用图表配置', () => {
    const result = parseEChartsOption(JSON.stringify({
      title: { text: '示例' },
      xAxis: { type: 'category', data: ['A', 'B'] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: [12, 20] }],
    }))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.option.series).toEqual([{ type: 'bar', data: [12, 20] }])
    if (result.ok) expect(result.option.tooltip).toMatchObject({ show: false, renderMode: 'richText' })
  })

  it.each([
    ['非法 JSON', '{"series": [}', '格式无效'],
    ['根节点数组', '[]', '必须是 JSON 对象'],
    ['函数表达式', '{"formatter":"function () {}"}', '脚本表达式'],
    ['模板表达式', '{"title":{"text":"${name}"}}', '脚本表达式'],
    ['危险字段', '{"__proto__":{"polluted":true}}', '危险字段'],
    ['远程资源', '{"graphic":{"style":{"image":"https://example.com/a.png"}}}', '远程资源'],
    ['未支持图表', '{"series":[{"type":"gauge"}]}', '不支持的图表类型'],
  ])('拒绝%s', (_label, source, message) => {
    const result = parseEChartsOption(source)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain(message)
  })

  it('拒绝超过大小限制的配置', () => {
    const result = parseEChartsOption(JSON.stringify({ text: 'x'.repeat(ECHARTS_MAX_SOURCE_LENGTH) }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('限制')
  })

  it('字符串 tooltip 保留内容但始终使用 Canvas richText，不能注入 HTML', () => {
    const formatter = '<img src=x onerror="window.__attack=1">{b}: {c}'
    const result = parseEChartsOption(JSON.stringify({
      tooltip: { renderMode: 'html', formatter },
      series: [{ type: 'bar', data: [1] }],
    }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.option.tooltip).toMatchObject({ renderMode: 'richText', formatter })
  })

  it.each([
    { toolbox: { feature: { dataView: { title: '<img src=x onerror="window.__attack=1">' } } } },
    { toolbox: [{ feature: { dataView: {} } }] },
    { title: { link: 'javascript:window.__attack=1' } },
    { title: { link: 'java\nscript:window.__attack=1' } },
    { graphic: { style: { image: 'image://https://example.test/a.svg' } } },
    { graphic: { style: { image: '//example.test/a.svg' } } },
    { graphic: { style: { image: 'data:image/svg+xml,<svg onload="window.__attack=1"/>' } } },
  ])('拒绝 HTML dataView 和危险资源入口 %j', (option) => {
    expect(parseEChartsOption(JSON.stringify(option)).ok).toBe(false)
  })

  it('拒绝配置时不将原始内容带入错误提示', () => {
    const result = parseEChartsOption('{"private":"anonymous-sensitive-content",')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).not.toContain('anonymous-sensitive-content')
  })
})
