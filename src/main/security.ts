/**
 * 安全层:渲染进程锁死 + 导航白名单。
 * 渲染进程(DSH 客户端与第三方插件跑的地方)永远没有 Node 权限。
 */
import { shell, type BrowserWindow, type WebContents, type WebFrameMain } from 'electron'

export function isTrustedAppUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'file:') return true
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

export function secureWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    // 外部链接一律走系统浏览器。
    if (!isTrustedAppUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedAppUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
}

export function isTrustedFrame(frame: WebFrameMain): boolean {
  return isTrustedAppUrl(frame.url)
}

export function isTrustedSender(contents: WebContents): boolean {
  return isTrustedAppUrl(contents.getURL())
}
