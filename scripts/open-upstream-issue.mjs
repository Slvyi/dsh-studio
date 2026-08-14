#!/usr/bin/env node
/**
 * Open a GitHub issue when the packaged dsh runtime is outdated.
 *
 * Reads the JSON produced by check-upstream.mjs (or re-runs the check itself)
 * and creates one issue per outdated package, skipping when an open issue
 * with the same title already exists. Used by .github/workflows/upstream-watch.yml;
 * GH_TOKEN (or an authenticated gh CLI) is required for the create step.
 *
 * Usage: node scripts/open-upstream-issue.mjs [--file upstream.json] [--dry-run]
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const fileFlag = args.indexOf('--file')
const jsonPath = fileFlag !== -1 ? args[fileFlag + 1] : undefined
const dryRun = args.includes('--dry-run')

const TITLE_PREFIX = 'upstream: dsh runtime outdated'

function gh(args, env = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', env: { ...process.env, ...env } })
  if (result.status !== 0 && result.stderr !== '') {
    throw new Error(`gh ${args[0]}: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

function parseSnapshot() {
  if (jsonPath !== undefined) {
    return JSON.parse(readFileSync(jsonPath, 'utf8'))
  }
  // No file given: re-run the check and parse its JSON output.
  const result = spawnSync('node', [join(root, 'scripts', 'check-upstream.mjs'), '--json'], {
    encoding: 'utf8',
  })
  if (result.status !== 0 && !result.stdout.includes('hasUpdate')) {
    throw new Error(`check-upstream failed: ${result.stderr.trim()}`)
  }
  return JSON.parse(result.stdout)
}

function bodyFor(outdated) {
  const lines = outdated.map((row) => `- ${row.pkg}: ${row.locked} → ${row.latest}`)
  return [
    'The packaged `@deepseek-ai/dsh` runtime is behind the latest npm release.',
    '',
    ...lines,
    '',
    'To ship the update:',
    '',
    '1. `node scripts/check-upstream.mjs` to confirm',
    '2. Bump the `@deepseek-ai/dsh-*` dependencies in package.json',
    '3. `pnpm install && pnpm package:mac:arm64`',
    '4. Create a new GitHub Release with the fresh DMG',
    '',
    '_(This issue was opened automatically by the upstream-watch workflow.)_',
  ].join('\n')
}

function main() {
  const snapshot = parseSnapshot()
  if (!snapshot.hasUpdate) {
    console.log('upstream current — no issue needed')
    return
  }
  const outdated = snapshot.rows.filter((row) => row.outdated)
  const title = `${TITLE_PREFIX} (${outdated.map((row) => row.pkg).join(', ')})`

  if (dryRun) {
    console.log(`[dry-run] would open issue: ${title}`)
    console.log(bodyFor(outdated))
    return
  }

  const existing = gh(['issue', 'list', '--state', 'open', '--search', TITLE_PREFIX, '--json', 'number', '--jq', 'length'])
  if (Number(existing) > 0) {
    console.log(`issue already open (${existing}) — skipping`)
    return
  }

  const url = gh(['issue', 'create', '--title', title, '--body', bodyFor(outdated)])
  console.log(`opened ${url}`)
}

main()
