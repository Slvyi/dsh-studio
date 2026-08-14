#!/usr/bin/env node
/**
 * Bump every @deepseek-ai/dsh-* dependency to the highest published version
 * of @deepseek-ai/dsh, then bump our own patch version.
 *
 * The dsh family ships as one version line; a package that does not have the
 * target version is left alone and reported as skipped. Never touches
 * non-dsh dependencies (cordis, cosmokit, schemastery keep their own lines).
 *
 * Usage:
 *   node scripts/bump-dsh-deps.mjs               # dry-run (print only)
 *   node scripts/bump-dsh-deps.mjs --apply       # write package.json
 *   node scripts/bump-dsh-deps.mjs --package /path/to/package.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const apply = args.includes('--apply')
const pkgFlag = args.indexOf('--package')
const pkgPath = pkgFlag !== -1 ? args[pkgFlag + 1] : join(root, 'package.json')
const registry = process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org'
const CONCURRENCY = 10

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

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return await response.json()
}

async function highestVersion(pkg) {
  const body = await fetchJson(`${registry}/${encodeURIComponent(pkg)}`)
  return Object.keys(body.versions).reduce((max, version) => (lt(max, version) ? version : max))
}

/** Cheap existence probe: GET the exact version document. */
async function versionExists(pkg, version) {
  try {
    const response = await fetch(`${registry}/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}`, {
      signal: AbortSignal.timeout(20_000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

async function main() {
  const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const target = await highestVersion('@deepseek-ai/dsh')

  const deps = manifest.dependencies ?? {}
  const keys = Object.keys(deps).filter((key) => key.startsWith('@deepseek-ai/dsh-'))

  const exists = await mapWithConcurrency(keys, CONCURRENCY, async (key) => {
    try {
      return { key, ok: await versionExists(key, target) }
    } catch {
      return { key, ok: false }
    }
  })

  const changed = []
  const skipped = []
  for (const { key, ok } of exists) {
    if (ok && deps[key] !== target) {
      changed.push({ key, from: deps[key], to: target })
      deps[key] = target
    } else if (!ok) {
      skipped.push({ key, version: deps[key] })
    }
  }

  let version = manifest.version
  if (changed.length > 0) {
    const [major, minor, patch] = version.split('.').map(Number)
    version = `${major}.${minor}.${patch + 1}`
  }

  if (apply && changed.length > 0) {
    manifest.version = version
    writeFileSync(pkgPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  console.log(JSON.stringify({ target, version, changed, skipped, apply }, null, 2))
}

main().catch((error) => {
  console.error(`bump-dsh-deps: ${error.message}`)
  process.exit(1)
})
