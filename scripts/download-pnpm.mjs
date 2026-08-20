#!/usr/bin/env node
/**
 * Download the pnpm standalone bundle (pnpm + dist/) into vendor/pnpm.
 *
 * Needed because the packaged app embeds vendor/pnpm so `dsh plugin` works on
 * a clean machine, but the bundle (~46 MB tarball) does not belong in git.
 * Run this once before `pnpm package:*`.
 *
 * Env overrides:
 *   PNPM_VERSION  pnpm version to fetch (default 11.21.0)
 *   PNPM_PLATFORM pnpm platform asset (default: derived from current platform/arch)
 *   PNPM_MIRROR   base URL prefix for the tarball (default GitHub releases)
 */
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.env.PNPM_VERSION ?? '11.21.0'
// pnpm standalone release assets: pnpm-<platform>-<arch>.tar.gz.
// Derive from the running machine by default.
const platform = process.env.PNPM_PLATFORM ?? `${process.platform}-${process.arch}`
const mirror =
  process.env.PNPM_MIRROR ??
  'https://github.com/pnpm/pnpm/releases/download/v' + version
const url = `${mirror}/pnpm-${platform}.tar.gz`
const vendorDir = join(root, 'vendor')
const tarball = join(vendorDir, `pnpm-${platform}.tar.gz`)
const targetDir = join(vendorDir, 'pnpm')

async function main() {
  await rm(targetDir, { recursive: true, force: true })
  await rm(tarball, { force: true })
  await mkdir(vendorDir, { recursive: true })

  process.stderr.write(`downloading ${url}\n`)
  // curl (not fetch): honours http_proxy/https_proxy env vars, and ships with
  // macOS and Linux — no extra dependency.
  const download = spawnSync('curl', ['-fsSL', '--retry', '3', url, '-o', tarball], { stdio: 'inherit' })
  if (download.status !== 0) {
    throw new Error(`download failed (curl exit ${download.status ?? 'unknown'}) — need network (and a proxy for github.com)`)
  }
  const size = (await stat(tarball)).size
  if (size < 10 * 1024 * 1024) {
    throw new Error(`suspiciously small tarball (${size} bytes); refusing to proceed`)
  }

  await mkdir(targetDir, { recursive: true })
  const extract = spawnSync('tar', ['-xf', tarball, '-C', targetDir], { stdio: 'inherit' })
  if (extract.status !== 0) throw new Error('archive extraction failed')

  const exeName = 'pnpm'
  const check = spawnSync(join(targetDir, exeName), ['--version'], { encoding: 'utf8' })
  if (check.status !== 0) throw new Error('vendor/pnpm/pnpm does not run')
  if (check.stdout.trim() !== version) {
    throw new Error(`vendor/pnpm/pnpm version ${check.stdout.trim()} != expected ${version}`)
  }

  await writeFile(join(vendorDir, 'pnpm.version'), `${version}\n`)
  process.stderr.write(`vendor/pnpm ready (pnpm ${check.stdout.trim()})\n`)
}

main().catch((error) => {
  console.error(`download-pnpm: ${error.message}`)
  process.exit(1)
})
