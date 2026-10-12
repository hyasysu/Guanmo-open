import { createHash } from 'node:crypto'

/** GitHub Pages 无自定义响应头：在最终 HTML 内用精确 hash 授权既有启动脚本。 */
export function addWebCsp(html: string, development: boolean): string {
  const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[1].trim())
    .map((match) => `'sha256-${createHash('sha256').update(match[1].replace(/\r\n?/g, '\n')).digest('base64')}'`)
  const policy = [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    // Chromium CSP 不接受 IPv6 host-source；http: 保留既有 [::1] 本地模型。
    // 公网 HTTP 仍由 Web 请求入口拒绝；Release 不允许 WebSocket。
    `connect-src 'self' https: http:${development ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
}
