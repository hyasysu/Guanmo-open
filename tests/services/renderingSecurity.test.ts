import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { addWebCsp } from '@scripts/webCsp'

describe('Web CSP 与桌面权限边界', () => {
  it('按浏览器换行语义授权既有启动脚本，修改脚本后 hash 失效', () => {
    const script = '\r\nwindow.__startup = true\r\n'
    const html = `<head></head><script>${script}</script>`
    const output = addWebCsp(html, false)
    const expected = createHash('sha256').update(script.replace(/\r\n/g, '\n')).digest('base64')
    expect(output).toContain(`'sha256-${expected}'`)
    expect(output).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(output).not.toContain('ws:')
    expect(output).toContain("frame-src 'none'")
    expect(addWebCsp(html.replace('true', 'false'), false)).not.toContain(expected)
    expect(addWebCsp(html, true)).toContain('ws://localhost:*')
  })

  it('桌面请求只经过 IPC，Release 不开放供应商和开发 WebSocket', () => {
    const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
    const csp: string = config.app.security.csp
    const connect = csp.split(';').find((directive) => directive.trim().startsWith('connect-src'))
    expect(connect?.trim()).toBe("connect-src 'self' ipc: http://ipc.localhost")
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).toContain("frame-src 'none'")
    expect(config.app.security.assetProtocol.scope).toEqual([])
  })

  it('所有注册的自定义 command 有精确 ACL，只授予本地主 WebView', () => {
    const source = readFileSync('src-tauri/src/lib.rs', 'utf8')
    const handler = source.match(/generate_handler!\[([\s\S]*?)\]/)?.[1] ?? ''
    const registered = [...handler.matchAll(/(?:\w+::)*(\w+)\s*,/g)].map((match) => match[1])
    const permission = readFileSync('src-tauri/permissions/main.toml', 'utf8')
    const allowed = [...(permission.match(/commands.allow = \[([\s\S]*?)\]/)?.[1] ?? '').matchAll(/"(\w+)"/g)]
      .map((match) => match[1])
    expect(registered.length).toBeGreaterThan(0)
    expect(allowed.sort()).toEqual(registered.sort())
    expect(allowed).not.toContain('load_secret')
    const capability = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'))
    expect(capability.webviews).toEqual(['main'])
    expect(capability.windows).toBeUndefined()
    expect(capability.remote).toBeUndefined()
    expect(capability.local).toBe(true)
    expect(capability.permissions).toContain('allow-main-commands')
    expect(capability.permissions.some((value: string) => value.startsWith('fs:'))).toBe(false)
  })
})
