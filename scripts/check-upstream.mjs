#!/usr/bin/env node
/**
 * Check the packaged dsh runtime against the latest npm release.
 *
 * DSH Studio's packaged mode pins @deepseek-ai/dsh (and the whole dsh-*
 * family) to one published version. This script reports whether upstream
 * has moved, so we know when to bump dependencies and rebuild.
 *
 * Usage: node scripts/check-upstream.mjs [--json]
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const PKGS = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-mcp-client']

const registry = process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org'

/** Parse "X.Y.Z[-rc.N]" into comparable parts; no prerelease sorts above any rc. */
function parseVersion(value) {
  const [core, pre] = value.split('-')
  const [major, minor, patch] = core.split('.').map(Number)
  const match = pre?.match(/^rc\.(\d+)$/)
  return { major, minor, patch, pre: match !== undefined ? Number(match[1]) : Infinity }
}

/** True when a < b by semver order. */
function lt(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  return (
    pa.major < pb.major ||
    (pa.major === pb.major && (pa.minor < pb.minor || (pa.minor === pb.minor && (pa.patch < pb.patch || (pa.patch === pb.patch && pa.pre < pb.pre)))))
  )
}

async function latestVersion(pkg) {
  const response = await fetch(`${registry}/${encodeURIComponent(pkg)}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`${pkg}: HTTP ${response.status}`)
  const body = await response.json()
  // Highest published version, not the dist-tag: upstream may forget to move
  // `latest` (dsh-mcp-client's latest still points at 0.0.1-rc.1).
  return Object.keys(body.versions).reduce((max, version) => (lt(max, version) ? version : max))
}

const rows = []
let upstream = null
for (const pkg of PKGS) {
  const locked = manifest.dependencies[pkg]
  let latest = 'unknown'
  try {
    latest = await latestVersion(pkg)
  } catch (error) {
    console.error(`check-upstream: ${error.message}`)
  }
  const outdated = latest !== 'unknown' && locked !== undefined && locked !== latest
  if (outdated) upstream = upstream ?? pkg
  rows.push({ pkg, locked: locked ?? '(not a dependency)', latest, outdated })
}

const hasUpdate = rows.some((row) => row.outdated)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), rows, hasUpdate }, null, 2))
} else {
  for (const row of rows) {
    const mark = row.outdated ? '⬆ OUTDATED' : row.latest === 'unknown' ? '? UNKNOWN' : '✓ current'
    console.log(`${mark.padEnd(10)} ${row.pkg.padEnd(30)} locked=${row.locked}  latest=${row.latest}`)
  }
  if (hasUpdate) {
    console.log(`\nupstream moved (${upstream}) — bump dependencies, rebuild, release`)
    process.exitCode = 1
  } else {
    console.log('\nupstream current — no action needed')
  }
}
