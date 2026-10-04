// Node 环境下提供最小 localStorage 垫片，驱动 service 层冒烟测试。
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  clear() {
    this.map.clear()
  }
}
;(globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() }

import {
  exportCheckRows,
  listCheckRows,
  submitCheckSheet,
} from '../src/api/setting-check-service'
import { listRows, saveRows } from '../src/data/local-store'
import { DEFECT_KEY, SETTING_CHECK_KEY } from '../src/domain/setting-check'
import type { EntryRow } from '../src/data/types'

// 从种子初始状态开始
let passed = 0
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FAIL: ${name}`)
  passed += 1
  console.log(`ok - ${name}`)
}

// 种子里 SETT-0003 是终态不符，首次加载迁移后应在缺陷待处理清单
const defectsAfterBoot = listRows(DEFECT_KEY)
const autoDefects = defectsAfterBoot.filter((d) => String(d['来源模块'] ?? '') === 'SETTINGCHECK:SETT-0003')
check('启动迁移：种子不符记录落入缺陷待处理', autoDefects.length === 1 && autoDefects[0].status === '待处理')

// 导出：核对人列存在且有值，结论列与列表同源
const csv = exportCheckRows().content
const header = csv.split('\n')[0]
check('导出表头含核对人列', header.includes('核对人') && header.includes('核对结论'))
const lines = csv.split('\n')
const sett3 = lines.find((l) => l.includes('SETT-0003'))!
check('导出核对人列未丢失', sett3.includes('李建国'))
check('导出不符行结论按现场定值写法', sett3.includes('不符：现场定值 0.90s 与台账定值 0.60s 不符'))
const sett2 = lines.find((l) => l.includes('SETT-0002'))!
check('复测记录导出判为一致', sett2.includes('一致：现场定值 1.05In'))

// 列表与导出结论逐行一致
for (const row of listCheckRows()) {
  const line = lines.find((l) => l.startsWith(String(row.id) + ','))
  check(`列表/导出行 ${row.id} 结论同源`, Boolean(line) && line.includes(String(row.核对结论)))
}

// 新建核对单
const r1 = submitCheckSheet({
  checkNo: 'SETT-0100',
  station: '测试站',
  device: '装置A',
  siteValue: '5A',
  ledgerValue: '5A',
  checker: '赵六',
  date: '2026-10-01',
  retest: false,
})
check('新建提交成功', r1.ok)
check('新建后只多一条', listRows(SETTING_CHECK_KEY).filter((r) => r.核对编号 === 'SETT-0100').length === 1)

// 同一张核对单重复提交：只留一条，更新原记录
const r2 = submitCheckSheet({
  checkNo: 'SETT-0100',
  station: '测试站',
  device: '装置A',
  siteValue: '6A',
  ledgerValue: '5A',
  checker: '赵六',
  date: '2026-10-02',
  retest: false,
})
check('重复同编号提交成功（更新）', r2.ok)
const dupRows = listRows(SETTING_CHECK_KEY).filter((r) => r.核对编号 === 'SETT-0100')
check('同核对单重复提交只留一条', dupRows.length === 1)
check('重复提交后复测判不符', dupRows[0].status === '核对不符')
check('采集记录保留两次', (dupRows[0].采集记录 as unknown[]).length === 2)

// 缺陷清单只增加一条
const d100 = listRows(DEFECT_KEY).filter((d) => String(d['来源模块'] ?? '') === 'SETTINGCHECK:SETT-0100')
check('重复提交不符只产生一条缺陷', d100.length === 1 && d100[0].status === '待处理')

// 再次重复提交（完全相同）：不新增采集、不新增缺陷
submitCheckSheet({
  checkNo: 'SETT-0100',
  station: '测试站',
  device: '装置A',
  siteValue: '6A',
  ledgerValue: '5A',
  checker: '赵六',
  date: '2026-10-02',
  retest: false,
})
const dupRows2 = listRows(SETTING_CHECK_KEY).filter((r) => r.核对编号 === 'SETT-0100')
check('完全相同重复提交不追加采集', (dupRows2[0].采集记录 as unknown[]).length === 2)
check('缺陷仍只有一条', listRows(DEFECT_KEY).filter((d) => String(d['来源模块'] ?? '') === 'SETTINGCHECK:SETT-0100').length === 1)

// 复测改回一致：待处理缺陷撤回
submitCheckSheet({
  checkNo: 'SETT-0100',
  station: '测试站',
  device: '装置A',
  siteValue: '5A',
  ledgerValue: '5A',
  checker: '赵六',
  date: '2026-10-03',
  retest: true,
})
const fixedRows = listRows(SETTING_CHECK_KEY).filter((r) => r.核对编号 === 'SETT-0100')
check('复测一致', fixedRows[0].status === '核对一致')
check('第三次采集已留痕（勾选复测）', (fixedRows[0].采集记录 as unknown[]).length === 3)
check('复测一致撤回自动缺陷', listRows(DEFECT_KEY).filter((d) => String(d['来源模块'] ?? '') === 'SETTINGCHECK:SETT-0100').length === 0)

// 手工把某缺陷置为处理中后，复测一致不应删除它
const seedDefect = listRows(DEFECT_KEY).find((d) => String(d['来源模块'] ?? '') === 'SETTINGCHECK:SETT-0003')
if (seedDefect) {
  const all = listRows(DEFECT_KEY).map((d) =>
    d.id === seedDefect.id
      ? ({ ...d, status: '处理中', 缺陷状态: '处理中' } as EntryRow)
      : d,
  )
  saveRows(DEFECT_KEY, all)
  submitCheckSheet({
    checkNo: 'SETT-0003',
    station: String(seedDefect ? '' : ''),
    device: '望江线202线路保护',
    siteValue: '0.60s',
    ledgerValue: '0.60s',
    checker: '李建国',
    date: '2026-10-03',
    retest: true,
  })
  const kept = listRows(DEFECT_KEY).filter((d) => String(d['来源模块'] ?? '') === 'SETTINGCHECK:SETT-0003')
  check('处理中缺陷不被撤回', kept.length === 1 && kept[0].status === '处理中')
}

// 列表行的核对人/结论都在
const listed = listCheckRows()
check('列表每条都带统一结论', listed.every((r) => typeof r.核对结论 === 'string' && r.核对结论.length > 0))

console.log(`\n${passed} checks passed`)
