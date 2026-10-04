// 冒烟测试入口：用 esbuild 的 JS API 临时打包领域/服务/迁移三组用例后依次执行。
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const cases = [
  'scripts/smoke-setting-check.ts',
  'scripts/smoke-setting-service.ts',
  'scripts/smoke-legacy-migration.ts',
]

const dir = mkdtempSync(join(tmpdir(), 'setting-check-smoke-'))
try {
  for (const [index, entry] of cases.entries()) {
    const outfile = join(dir, `smoke-${index}.mjs`)
    await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile,
      logLevel: 'warning',
    })
    await import(pathToFileURL(outfile).href)
  }
  console.log('\n全部冒烟用例通过')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
