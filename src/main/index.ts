/**
 * 主进程:窗口、菜单、托盘、单实例、生命周期。
 *
 * 常驻体验:
 * - 关窗口不退出(dock 保留,托盘显隐)
 * - 托盘菜单:显示/隐藏、重启 dsh、打开日志、退出
 * - 单实例锁:二次启动聚焦已有窗口
 * - 退出时优雅 kill dsh 子进程(会话落盘)
 */
import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray, type MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { HarnessRuntime, resolveDshHome } from './runtime'
import { isTrustedAppUrl, secureWindow } from './security'

let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let runtime!: HarnessRuntime
let quitting = false
let failureDialogVisible = false

function logPath(): string {
  return join(app.getPath('logs'), 'dsh-studio.log')
}

function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'assets', 'icon.png')
}

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tray-icon.png')
    : join(app.getAppPath(), 'assets', 'tray-icon.png')
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: 'DSH Studio',
    icon: iconPath(),
    backgroundColor: '#f8f8f6',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle('DSH Studio')
  })
  secureWindow(window)
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  mainWindow = window
  return window
}

async function openHarness(url: string): Promise<void> {
  const window = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : createWindow()
  if (isTrustedAppUrl(url)) {
    await window.loadURL(url)
  }
  window.show()
  window.focus()
}

async function launchHarness(): Promise<void> {
  mainWindow?.hide()
  await runtime.start()
  const snapshot = runtime.snapshot()
  if (snapshot.phase === 'ready' && snapshot.url !== undefined) {
    await openHarness(snapshot.url)
  } else if (snapshot.phase === 'failed') {
    void showRuntimeFailure(snapshot)
  }
}

async function showRuntimeFailure(snapshot: ReturnType<HarnessRuntime['snapshot']>): Promise<void> {
  if (failureDialogVisible || quitting) return
  failureDialogVisible = true
  try {
    while (!quitting && runtime.snapshot().phase === 'failed') {
      const options: Electron.MessageBoxOptions = {
        type: 'error',
        title: 'dsh could not start',
        message: snapshot.message,
        detail: `dsh home: ${resolveDshHome()}\n\nYou can retry or inspect the log.`,
        buttons: ['Retry', 'Show Log', 'Quit'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      }
      const result = await dialog.showMessageBox(options)
      if (result.response === 0) {
        await launchHarness()
      } else if (result.response === 1) {
        shell.showItemInFolder(logPath())
        continue
      } else {
        app.quit()
      }
      if (runtime.snapshot().phase !== 'failed') return
      snapshot = runtime.snapshot()
    }
  } finally {
    failureDialogVisible = false
  }
}

function installMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'Harness',
      submenu: [
        { label: 'Restart dsh', accelerator: 'CmdOrCtrl+Shift+R', click: () => void launchHarness() },
        { label: 'Show dsh Log', click: () => shell.showItemInFolder(logPath()) },
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function installTray(): void {
  const iconPath_ = trayIconPath()
  const icon = existsSync(iconPath_) ? nativeImage.createFromPath(iconPath_) : nativeImage.createEmpty()
  if (!icon.isEmpty()) icon.setTemplateImage(true)
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('DSH Studio')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show / Hide Window',
        click: () => {
          if (mainWindow === undefined || mainWindow.isDestroyed()) {
            const snapshot = runtime.snapshot()
            if (snapshot.url !== undefined) void openHarness(snapshot.url)
            else void launchHarness()
          } else if (mainWindow.isVisible()) {
            mainWindow.hide()
          } else {
            mainWindow.show()
            mainWindow.focus()
          }
        },
      },
      {
        label: 'Restart dsh',
        click: () => void launchHarness(),
      },
      {
        label: 'Launch at Login',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true })
        },
      },
      { type: 'separator' },
      {
        label: 'Quit DSH Studio',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', () => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) mainWindow.hide()
      else {
        mainWindow.show()
        mainWindow.focus()
      }
    } else {
      void launchHarness()
    }
  })
}

/**
 * 检测另一个 dsh 实例是否在跑。
 *
 * 红线:两个 dsh 实例(桌面壳 + web)共享 ~/.dsh 时会并发写同一个会话日志,
 * 导致 seq 交错、日志损坏、历史加载失败。web 默认监听 127.0.0.1:3080,
 * 探测到它即提示;用户改了 --port 时此检测失效,靠 README 红线兜底。
 */
async function detectOtherDshInstance(): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: 3080 })
    socket.setTimeout(1500)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function bootstrap(): Promise<void> {
  runtime = new HarnessRuntime(logPath())

  if (await detectOtherDshInstance()) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: '另一个 dsh 实例正在运行',
      message: '检测到 web 实例正在运行(127.0.0.1:3080)。',
      detail:
        '两个实例共享 ~/.dsh 会并发写同一个会话日志,导致日志损坏、历史丢失。\n\n'
        + `dsh home: ${resolveDshHome()}\n\n建议:先退出 web(或本应用),再启动另一个。`,
      buttons: ['继续启动(风险自担)', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (response !== 0) {
      app.quit()
      return
    }
  }

  if (process.platform === 'darwin') {
    try {
      const icon = nativeImage.createFromPath(iconPath())
      if (!icon.isEmpty()) app.dock?.setIcon(icon)
    } catch {
      // 图标缺失不影响启动。
    }
  }

  installMenu()
  installTray()
  await launchHarness()
}

// 单实例锁:第二次启动聚焦已有窗口,并提示其打开。
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => void bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    dialog.showErrorBox('DSH Studio encountered an error', message)
  }))

  // 关窗口不退出 —— 常驻托盘。
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      // 非 macOS 也保持常驻,退出走托盘菜单。
    }
  })

  app.on('activate', () => {
    if (mainWindow === undefined || mainWindow.isDestroyed()) {
      const snapshot = runtime?.snapshot()
      if (snapshot?.url !== undefined) void openHarness(snapshot.url)
      else void launchHarness()
    }
  })

  app.on('before-quit', () => {
    quitting = true
  })

  app.on('will-quit', () => {
    void runtime?.stop()
  })
}
