/**
 * dsh 服务生命周期:随机端口 + spawn + 就绪探测 + 优雅退出。
 *
 * 两种启动模式:
 * - source(开发/自用):spawn `pnpm dsh`(源码 tsx 启动),跟随 dsh 仓库 main,
 *   会话/插件/凭据全部复用 ~/.dsh。
 * - packaged(分发):复用 Electron 自带 Node(ELECTRON_RUN_AS_NODE),跑 npm 安装的
 *   @deepseek-ai/dsh lib/bin.js,数据同样指向 ~/.dsh。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream, existsSync, readdirSync, type WriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { RuntimePhase, RuntimeSnapshot } from '../shared/contracts'

export interface LaunchSpec {
  /** 命令名(经 shell 解析)或可执行文件绝对路径。 */
  command: string
  args: string[]
  cwd: string
}

export function resolveDshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

export function resolveLaunchSpec(port: number): LaunchSpec {
  const sourceRepo = process.env.DSH_SOURCE_REPO
  if (sourceRepo !== undefined && sourceRepo !== '') {
    // 源码模式:跟随 dsh 仓库 main,由用户仓库的 pnpm 启动。
    return {
      command: 'pnpm',
      args: ['dsh', '--profile', 'web', '--host', '127.0.0.1', '--port', String(port)],
      cwd: sourceRepo,
    }
  }
  // 打包模式:electron 自带 Node 直接跑 npm 安装的 dsh 入口。
  return {
    command: process.execPath,
    args: ['--expose-internals', dshEntryPath(), 'web', '--host', '127.0.0.1', '--port', String(port)],
    cwd: homedir(),
  }
}

function dshEntryPath(): string {
  if (process.env.DSH_ENTRY !== undefined) return process.env.DSH_ENTRY
  if (process.defaultApp) {
    return join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  }
  // 打包模式:asar: false,node_modules 以真实目录在 Resources/app/ 下,
  // ELECTRON_RUN_AS_NODE 子进程直接读真实文件系统。
  return join(process.resourcesPath, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/**
 * 子进程 PATH 前缀(打包模式)。
 *
 * 目的:
 * 1. 内置 pnpm(Resources/pnpm)让 `dsh plugin` 在干净机器上可用;
 * 2. macOS:Finder/launchd 启动的进程 PATH 极瘦(/usr/bin:/bin:…),没有
 *    Homebrew(/opt/homebrew/bin)等用户工具路径 —— dsh 的 bash 工具
 *    继承这个 PATH,补上常见位置避免"命令找不到";
 * 3. macOS:nvm 管理的 Node(nvm 是 shell 函数,不会进 launchd 环境)——探测
 *    最新版本目录,让 bash 工具也能用 `node`/`npm`。
 */
function childPathPrefix(): string[] {
  const prefix: string[] = []
  if (!process.defaultApp) {
    prefix.push(join(process.resourcesPath, 'pnpm'))
  }
  prefix.push('/opt/homebrew/bin', '/usr/local/bin')
  try {
    const nodeRoot = join(homedir(), '.nvm', 'versions', 'node')
    const versions = readdirSync(nodeRoot).sort().reverse()
    if (versions[0] !== undefined) prefix.push(join(nodeRoot, versions[0], 'bin'))
  } catch {
    // 无 nvm,跳过。
  }
  return prefix
}


async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Could not resolve a local port.'))
        return
      }
      const { port } = address
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

async function waitUntilReady(url: string, isAlive: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive()) return false
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      // 服务还没就绪,继续探测。
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

export class HarnessRuntime {
  private child?: ChildProcessWithoutNullStreams
  private logStream?: WriteStream
  private phase: RuntimePhase = 'idle'
  private message = 'dsh is not running.'
  private url?: string
  private readonly logLines: string[] = []

  constructor(private readonly logPath: string, private readonly startupTimeoutMs = 45_000) {}

  snapshot(): RuntimeSnapshot {
    return { phase: this.phase, message: this.message, url: this.url, logs: [...this.logLines] }
  }

  async start(): Promise<void> {
    await this.stop()
    this.url = undefined

    const dshHome = resolveDshHome()
    await mkdir(dshHome, { recursive: true })
    await mkdir(dirname(this.logPath), { recursive: true })
    this.logStream = createWriteStream(this.logPath, { flags: 'a' })

    const port = await reservePort()
    const url = `http://127.0.0.1:${port}`
    const spec = resolveLaunchSpec(port)

    this.writeLog(`[desktop] starting ${new Date().toISOString()}`)
    this.writeLog(`[desktop] dsh home ${dshHome}`)
    this.writeLog(`[desktop] endpoint ${url}`)
    this.writeLog(`[desktop] launch ${spec.command} ${spec.args.join(' ')} (cwd ${spec.cwd})`)
    this.setState('starting', 'Starting dsh…')

    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_HOME: dshHome,
        NO_COLOR: '1',
        PATH: [...childPathPrefix(), process.env.PATH ?? ''].filter(Boolean).join(delimiter),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: spec.command === 'pnpm',
      windowsHide: true,
    })
    this.child = child

    child.stdout.on('data', (chunk: Buffer) => this.writeChunk('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => this.writeChunk('stderr', chunk))
    child.once('error', (error) => {
      if (this.child !== child) return
      this.child = undefined
      this.setState('failed', `dsh could not start: ${error.message}`)
    })
    child.once('exit', (code, signal) => {
      if (this.child !== child) return
      this.child = undefined
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`
      this.setState('failed', `dsh stopped unexpectedly (${detail}).`)
    })

    const ready = await waitUntilReady(url, () => this.child === child && child.exitCode === null, this.startupTimeoutMs)

    if (this.child !== child) return
    if (!ready) {
      await this.stopChild(child)
      this.setState('failed', `dsh did not become ready within ${this.startupTimeoutMs / 1000} seconds.`)
      return
    }

    this.url = url
    this.setState('ready', 'dsh is ready.')
  }

  async stop(): Promise<void> {
    const child = this.child
    if (child !== undefined) {
      await this.stopChild(child)
      this.child = undefined
    }
    this.url = undefined
    this.phase = 'idle'
    this.message = 'dsh is not running.'
    this.closeLog()
  }

  async restart(): Promise<void> {
    await this.start()
  }

  private async stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 5000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  private setState(phase: RuntimePhase, message: string): void {
    this.phase = phase
    this.message = message
  }

  private writeLog(line: string): void {
    this.logLines.push(line)
    if (this.logLines.length > 500) this.logLines.shift()
    this.logStream?.write(`${line}\n`)
  }

  private writeChunk(stream: 'stdout' | 'stderr', chunk: Buffer): void {
    const text = chunk.toString('utf8').trimEnd()
    if (text !== '') this.writeLog(`[${stream}] ${text}`)
  }

  private closeLog(): void {
    this.logStream?.end()
    this.logStream = undefined
  }
}
