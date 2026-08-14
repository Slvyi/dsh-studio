# DSH Studio

[English](README.md)

> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(`dsh`)的 macOS 桌面客户端:托盘常驻窗口,本地运行 dsh web 服务,数据与 CLI、web 版**共用 `~/.dsh`**——会话、插件、凭据 100% 兼容,零迁移成本。

DSH Studio 运行官方 `@deepseek-ai/dsh` 运行时(与 `dsh web` 启动的是同一个引擎),外面套一层原生壳:托盘常驻、开机自启、单实例防护、内置 pnpm——干净机器上插件管理也能开箱即用。

## 特性

- **托盘常驻**:关窗不退出;托盘菜单可显隐窗口 / 重启 dsh / 退出
- **开机自启**:菜单一键开关
- **同一份 `~/.dsh`**:DSH Studio、`dsh` CLI、web 版随意切换,无需迁移、无需拷贝
- **内置 pnpm**:`dsh plugin` 开箱即用,即使机器没装 pnpm
- **单实例防护**:启动时检测其他 dsh 实例并警告,避免并发写坏会话日志

## 安装

1. 从 [Releases](https://github.com/Slvyi/dsh-studio/releases) 下载 `DSH Studio-<版本>-arm64.dmg`
2. 打开 dmg,把 DSH Studio 拖入 Applications
3. 未签名构建首次打开会被 Gatekeeper 拦截,放行一次:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/DSH Studio.app"
   ```

4. 配置 API key:应用内 Models 页面写入,或手动创建 `~/.dsh/.credentials.yaml`:

   ```yaml
   DEEPSEEK_API_KEY: sk-xxxx
   ```

5. 启动即用。换机器:直接拷贝整个 `~/.dsh` 目录,一切随行。

> 要求:Apple Silicon,macOS 13+。仅 arm64 构建,暂不支持 Intel。

## 本地调试

```sh
pnpm install
pnpm dev              # 开发模式(使用 npm 发布的 dsh 版本)
```

跟随 dsh 源码仓库 main 调试:

```sh
DSH_SOURCE_REPO=/path/to/deepseek-harness pnpm dev
```

环境变量:

| 变量 | 作用 |
|---|---|
| `DSH_SOURCE_REPO` | 设置 → 以源码仓库 `pnpm dsh` 启动(跟随 main) |
| `DSH_ENTRY` | 覆盖打包模式的 dsh 入口路径 |
| `DSH_HOME` | 覆盖数据目录(默认 `~/.dsh`) |

日志:`~/Library/Logs/dsh-desktop/dsh-studio.log`

## 打包发布

```sh
pnpm download-pnpm      # 首次:拉取 pnpm standalone 到 vendor/pnpm(~46MB,不入库)
pnpm package:mac:arm64  # 或 pnpm package:mac:x64
```

产物在 `release/` 下(`.dmg` + `.app`)。

要点:

- 打包嵌入 pnpm standalone,干净机器上 `dsh plugin` 可用;`package:*` 脚本自动下载,`PNPM_MIRROR` 可换镜像
- 打包模式以 `ELECTRON_RUN_AS_NODE` 运行 npm 发布的 `@deepseek-ai/dsh`;要最新 main 用 `DSH_SOURCE_REPO`
- 本机有 Apple Developer ID 证书时 electron-builder 自动签名(未公证);公开分发前建议补 notarize 公证

## 与 DeepSeek Harness 的关系

- 运行官方 `@deepseek-ai/dsh` 运行时——与 `dsh web` 完全相同的引擎
- 数据 100% 兼容:同一 `~/.dsh`、同一会话日志格式、同一插件与凭据
- 插件管理走真实 `dsh plugin` 管线,内置 pnpm
- 社区项目,与 DeepSeek 无隶属关系;harness 本体见 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)

## 项目结构

```
src/main/index.ts    主进程:窗口 / 菜单 / 托盘 / 单实例 / 生命周期
src/main/runtime.ts  dsh 生命周期:随机端口 + spawn + 就绪探测 + 优雅退出
src/main/security.ts 渲染进程安全:contextIsolation 锁死 + URL 白名单
src/shared/contracts.ts  启动阶段快照类型
```
