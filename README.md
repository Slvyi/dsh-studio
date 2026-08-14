# DSH Studio

[中文](README.zh.md)

> A macOS desktop client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`): a tray-resident window over the local dsh web service, sharing the same `~/.dsh` data home — sessions, plugins, and credentials are 100% compatible with the CLI and web edition.

DSH Studio runs the official `@deepseek-ai/dsh` runtime (the same one `dsh web` boots), adds a native shell: tray persistence, launch at login, single-instance guard, and a bundled pnpm so plugin management works even on a clean machine.

## Features

- **Tray-resident**: close the window, keep working — tray menu shows/hides the window, restarts dsh, or quits
- **Launch at Login**: one menu toggle
- **Same `~/.dsh` home**: swap freely between DSH Studio, `dsh` CLI, and the web edition — no migration, no copies
- **Bundled pnpm**: `dsh plugin` works out of the box, even where pnpm is not installed
- **Single-instance guard**: detects another dsh instance on boot and warns, so concurrent writers can't corrupt session logs

## Install

1. Download `DSH Studio-<version>-arm64.dmg` from [Releases](https://github.com/Slvyi/dsh-studio/releases)
2. Open the dmg and drag DSH Studio into Applications
3. Unsigned builds are blocked by Gatekeeper on first launch — allow it once:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/DSH Studio.app"
   ```

4. Provide an API key: write it on the Models page inside the app, or create `~/.dsh/.credentials.yaml`:

   ```yaml
   DEEPSEEK_API_KEY: sk-xxxx
   ```

5. Launch and go. To move from another machine, copy the whole `~/.dsh` directory — everything comes with it.

> Requirements: Apple Silicon, macOS 12+. arm64 builds only; Intel is not supported yet.

## Development

```sh
pnpm install
pnpm dev              # dev mode, uses the npm-published dsh
```

Follow the dsh source repository `main` instead:

```sh
DSH_SOURCE_REPO=/path/to/deepseek-harness pnpm dev
```

Environment variables:

| Variable | Effect |
|---|---|
| `DSH_SOURCE_REPO` | when set, boot via `pnpm dsh` from a source checkout (follows `main`) |
| `DSH_ENTRY` | override the packaged dsh entry path |
| `DSH_HOME` | override the data home (default `~/.dsh`) |

Logs: `~/Library/Logs/dsh-desktop/dsh-studio.log`

## Packaging

```sh
pnpm download-pnpm      # first run: fetch the pnpm standalone bundle into vendor/pnpm (~46 MB, not committed)
pnpm package:mac:arm64  # or pnpm package:mac:x64
```

Artifacts land in `release/` (`.dmg` + `.app`).

Notes:

- The pnpm standalone bundle is embedded in the app so `dsh plugin` works on clean machines; `package:*` scripts fetch it automatically, `PNPM_MIRROR` switches the mirror
- The packaged mode runs the npm-published `@deepseek-ai/dsh` via `ELECTRON_RUN_AS_NODE`; use `DSH_SOURCE_REPO` for the latest `main`
- Builds are **unsigned by default** (adhoc, `dmg.sign: false`). Before public distribution: sign with an Apple Developer ID and notarize.

## DeepSeek Harness integration

- Runs the official `@deepseek-ai/dsh` runtime — the exact engine behind `dsh web`
- 100% data compatibility: same `~/.dsh` home, same session log format, same plugins and credentials
- Plugin management goes through the real `dsh plugin` pipeline with a bundled pnpm
- Community project, not affiliated with DeepSeek; see [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) for the harness itself

## Project layout

```
src/main/index.ts     main process: window / menu / tray / single-instance / lifecycle
src/main/runtime.ts   dsh lifecycle: random port + spawn + readiness probe + graceful exit
src/main/security.ts  renderer security: contextIsolation + URL allowlist
src/shared/contracts.ts  boot stage snapshot types
```

## Acknowledgments

This project was developed entirely with DeepSeek vibe coding — please forgive any rough edges. Right now the era is 梁圣 — it may not always be.
