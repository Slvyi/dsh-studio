#!/usr/bin/env node
/**
 * 打包前验证:当前平台/arch 与目标一致,防止在错误机器上出包。
 * 用法:node scripts/verify-target.mjs darwin arm64
 */
const [platform, arch] = process.argv.slice(2)
const actual = { darwin: process.platform === 'darwin', win32: process.platform === 'win32' }
const archActual = process.arch

if (platform !== undefined && !actual[platform]) {
  console.error(`target platform mismatch: expected ${platform}, running on ${process.platform}`)
  process.exit(1)
}
if (arch !== undefined && archActual !== arch) {
  console.error(`target arch mismatch: expected ${arch}, running on ${archActual}`)
  process.exit(1)
}
console.log(`verify-target ok: ${process.platform}/${archActual}`)
