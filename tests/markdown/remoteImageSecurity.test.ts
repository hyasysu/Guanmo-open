import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('桌面远程图片安全策略', () => {
  it('仅允许通过 HTTPS 加载远程图片', () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8'),
    ) as { app: { security: { csp: string } } }
    const imageDirective = config.app.security.csp
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('img-src '))

    expect(imageDirective?.split(/\s+/)).toContain('https:')
    expect(imageDirective?.split(/\s+/)).not.toContain('http:')
  })
})
