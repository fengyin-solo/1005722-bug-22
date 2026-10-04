// 模拟 v1 版本的旧 localStorage 数据（无采集记录、旧结论写法、状态可能错误），验证升级回填。
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
  seedV1() {
    const data = {
      settingcheck: [
        {
          id: 1,
          status: '核对中',
          pending: true,
          abnormal: false,
          核对编号: 'OLD-001',
          所属变电站: '旧站',
          装置名称: '旧装置1',
          现场定值: '3.30',
          台账定值: '3.3',
          核对人: '甲',
          核对日期: '2026-08-01',
          核对状态: '核对中',
        },
        {
          id: 2,
          status: '核对一致', // 旧结论：按状态判一致，但现场与台账实际不符
          pending: false,
          abnormal: false,
          核对编号: 'OLD-002',
          所属变电站: '旧站',
          装置名称: '旧装置2',
          现场定值: '100A',
          台账定值: '120A',
          核对人: '乙',
          核对日期: '2026-08-02',
          核对状态: '核对一致',
        },
      ],
      defect: [
        {
          id: 1,
          status: '待处理',
          pending: true,
          abnormal: false,
          缺陷编号: 'DEFE-0001',
          缺陷设备: '其他设备',
          缺陷等级: '紧急',
          缺陷描述: '人工登记的缺陷',
          发现人: '丙',
          处理期限: '2026-09-01',
          处理人: '',
          缺陷状态: '待处理',
        },
      ],
    }
    this.map.set('substation-protection:entries', JSON.stringify(data))
    this.map.set('substation-protection:version', '1')
  }
}

const storage = new MemoryStorage()
storage.seedV1()
;(globalThis as { window?: unknown }).window = { localStorage: storage }

import { allRows, listRows } from '../src/data/local-store'

let passed = 0
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FAIL: ${name}`)
  passed += 1
  console.log(`ok - ${name}`)
}

const rows = allRows()
check('版本已升级', storage.getItem('substation-protection:version') === '2')

const c1 = rows.settingcheck.find((r) => r.核对编号 === 'OLD-001')!
check('旧记录1按现场/台账判一致（3.30 与 3.3）', c1.status === '核对一致')
check('旧记录1补了首条采集记录', (c1.采集记录 as unknown[]).length === 1)
check('旧记录1结论按现场定值写法', String(c1.核对结论).startsWith('一致：现场定值 3.30'))

const c2 = rows.settingcheck.find((r) => r.核对编号 === 'OLD-002')!
check('旧记录2纠正为不符（不再信旧状态）', c2.status === '核对不符' && c2.abnormal === true)
check('旧记录2结论统一写法', String(c2.核对结论).startsWith('不符：现场定值 100A'))

// 回填顺序：按 id（采集顺序）逐条回填，两条都在
check('两条旧记录都保留', rows.settingcheck.length === 2)

// 不符记录落缺陷待处理清单，人工缺陷保留
const defects = listRows('defect')
check('人工登记缺陷保留', defects.some((d) => d.缺陷编号 === 'DEFE-0001'))
const auto = defects.filter((d) => String(d.来源模块 ?? '') === 'SETTINGCHECK:OLD-002')
check('旧不符记录回填后产生一条自动缺陷', auto.length === 1 && auto[0].status === '待处理')
check('自动缺陷编号不与人工重号', !defects.some((d) => d !== auto[0] && d.缺陷编号 === auto[0].缺陷编号))

// 落库 JSON 即为最终态：再次加载版本已是 2，不会重复迁移产生重复缺陷
const before = listRows('defect').length
const raw = JSON.parse(storage.getItem('substation-protection:entries')!)
check('落库数据稳定无重复缺陷', raw.defect.length === before)
check('落库核对结论已回填', raw.settingcheck.every((r: Record<string, unknown>) => typeof r.核对结论 === 'string'))

console.log(`\n${passed} checks passed`)
