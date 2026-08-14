# DSH Studio

DeepSeek Harness 桌面壳:托盘常驻窗口,加载本机 dsh web 服务,**数据复用 `~/.dsh`**(会话/插件/凭据无缝)。

> ## ⚠️ 红线:同一时间只开一个实例
>
> 桌面壳和 web(或其他 dsh 实例)**共享 `~/.dsh`,并发写同一个会话日志会导致 seq 交错、日志损坏、历史加载失败**(已实际踩过)。壳启动时会探测 3080 端口并弹警告,但探测不是万能的(web 改了 `--port` 就测不到)。
>
> **切换方式:先退出当前实例,再启动另一个。** 壳的退出走托盘菜单「Quit DSH Studio」;web 用 Ctrl+C。

## 运行

```sh
# 开发模式(跟随 dsh 源码仓库 main,推荐自用)
DSH_SOURCE_REPO=/Users/mac/Documents/deepseek-harness pnpm dev

# 或构建后运行
pnpm build
DSH_SOURCE_REPO=/Users/mac/Documents/deepseek-harness ./node_modules/.bin/electron .
```

启动后:dsh 服务跑在随机端口(`~/Library/Logs/dsh-desktop/dsh-studio.log` 可查),窗口加载就绪后显示。关窗口不退出,托盘常驻;托盘菜单可显隐窗口 / 重启 dsh / 退出。

## 打包

```sh
pnpm download-pnpm   # 首次:拉取 pnpm standalone 到 vendor/pnpm(~46MB,不进 git)
pnpm package:mac:arm64   # 产物 release/ 下 .dmg
```

`vendor/pnpm` 是打包时嵌入的 pnpm(让干净机器上 `dsh plugin` 可用),体积大不进 git;`package:*` 脚本会自动先跑下载。国内网络可直接设 `PNPM_MIRROR` 换镜像。

打包关键决策(踩坑记录):

- **`asar: false`**:dsh 子进程以 `ELECTRON_RUN_AS_NODE` 运行,是纯 Node 模式,**读不了 asar**——所以 node_modules 必须以真实目录进 `Resources/app/`
- **Electron ≥ 36**(本项目 43):dsh 需要 Node ≥ 22.19(`node:zlib` zstd、`node:module` stripTypeScriptTypes),Electron 33 内置 Node 20 会直接 SyntaxError
- **195 个 `@deepseek-ai/*` 全部显式列 dependencies**:pnpm 默认只把直接依赖 hoist 到顶层,传递依赖在 `.pnpm` 私有目录,electron-builder 复制会丢(缺 `cordis-plugin-group` 报错);显式列出后全部进顶层 node_modules
- 打包模式 dsh 入口:`Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js`
- 本机钥匙串有 Developer ID 证书时 electron-builder 自动签名(未公证);分发前需 notarize

## 架构

```
src/main/index.ts    主进程:窗口/菜单/托盘/单实例/生命周期
src/main/runtime.ts  dsh 生命周期:随机端口 + spawn + 就绪探测 + 优雅退出
src/main/security.ts 安全:渲染进程锁死 + URL 白名单(外部链接走系统浏览器)
src/shared/contracts.ts  阶段快照类型
```

启动模式由环境变量决定:

| 变量 | 作用 |
|---|---|
| `DSH_SOURCE_REPO` | 设了 → 源码模式(`pnpm dsh`,跟随仓库 main) |
| `DSH_ENTRY` | 打包模式覆盖 dsh 入口路径 |
| `DSH_HOME` | 覆盖数据目录(默认 `~/.dsh`) |

## 已知限制

- **并发**:壳与浏览器 web 同时跑会共享 `~/.dsh`(写侧有锁,但建议同一时间只用其一)
- 源码模式 spawn `pnpm`,需 PATH 可解析(从终端启动没问题;launchd 场景设绝对路径)
- 图标:assets/ 下 icon.png(128px+)/ tray-icon.png(模板图)可替换,缺失时用空图标兜底
- macOS 未签名 app 换机器需 `xattr -dr com.apple.quarantine`

## 分发清单(将来)

1. Apple Developer ID($99/年)+ `electron-builder --mac` 签名配置 + notarytool 公证
2. electron-updater 自动更新 + GitHub Releases feed
3. GitHub Actions 双架构构建
