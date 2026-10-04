import {
  applyOutcome,
  backfillSettingCheck,
  deriveCheckOutcome,
  presentCheckRow,
  reconcileDefects,
  normalizeValue,
} from '../src/domain/setting-check'
import type { EntryRow } from '../src/data/types'

let passed = 0
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FAIL: ${name}`)
  passed += 1
  console.log(`ok - ${name}`)
}

// 1) 归一化：尾随零、空格、+号不影响一致性
check('normalize 1.0 == 1', normalizeValue('1.0') === normalizeValue('1'))
check('normalize 空格与单位', normalizeValue(' 800 A ') === normalizeValue('800A'))

// 2) 初判不符、复测一致：复测记录不得再被判成不一致
const retestedRow: EntryRow = {
  id: 1,
  status: '核对不符',
  pending: false,
  abnormal: true,
  核对编号: 'SETT-X1',
  所属变电站: 'S1',
  装置名称: 'D1',
  现场定值: '1.10',
  台账定值: '1.05',
  核对人: '张三',
  核对日期: '2026-09-01',
  采集记录: [
    { round: 1, siteValue: '1.10', ledgerValue: '1.05', checker: '张三', date: '2026-09-01', retest: false },
    { round: 2, siteValue: '1.05', ledgerValue: '1.05', checker: '张三', date: '2026-09-03', retest: true },
  ],
}
const outcome = deriveCheckOutcome(retestedRow)
check('复测后按最后一次采集判一致', outcome.status === '核对一致' && outcome.consistent)
check('结论以现场定值统一写法', outcome.conclusion.startsWith('一致：现场定值 1.05'))
check('结论轮次为第2次', outcome.round === 2)

const applied = applyOutcome(retestedRow)
check('applyOutcome 回写状态/待办/异常', applied.status === '核对一致' && applied.pending === false && applied.abnormal === false)

// 3) 列表与核对单结论同源：presentCheckRow 与 deriveCheckOutcome 文案一致
const presented = presentCheckRow(retestedRow)
check('列表呈现与判定同源', presented.核对结论 === outcome.conclusion && presented.status === outcome.status)

// 4) 存量回填：无采集记录的旧数据按现场/台账补首采，结论重算
const legacy: EntryRow[] = [
  {
    id: 9,
    status: '核对不符', // 旧状态是错的（现场与台账实际一致）
    pending: false,
    abnormal: true,
    核对编号: 'OLD-1',
    装置名称: 'D9',
    现场定值: '2.00',
    台账定值: '2',
    核对人: '李四',
    核对日期: '2026-08-01',
  },
]
const backfilled = backfillSettingCheck(legacy)
check('存量按采集顺序回填采集记录', (backfilled[0].采集记录 as unknown[]).length === 1)
check('存量结论统一重算为一致', backfilled[0].status === '核对一致' && backfilled[0].abnormal === false)
check('存量核对结论按现场定值写法', String(backfilled[0].核对结论).includes('现场定值 2.00'))

// 5) 不符落缺陷待处理清单，重复对账只产生一条
const mismatchRow: EntryRow = {
  id: 2,
  status: '核对不符',
  pending: false,
  abnormal: true,
  核对编号: 'SETT-X2',
  所属变电站: 'S2',
  装置名称: 'D2',
  现场定值: '0.9s',
  台账定值: '0.6s',
  核对人: '王五',
  核对日期: '2026-09-05',
  采集记录: [
    { round: 1, siteValue: '0.9s', ledgerValue: '0.6s', checker: '王五', date: '2026-09-05', retest: false },
  ],
}
let defects = reconcileDefects([mismatchRow], [])
check('不符产生一条待处理缺陷', defects.length === 1 && defects[0].status === '待处理')
check('缺陷编号自动生成', /^DEFE-\d{4}$/.test(String(defects[0].缺陷编号)))
check('缺陷描述带来源核对单', String(defects[0].缺陷描述).includes('SETT-X2'))
const defectsAgain = reconcileDefects([mismatchRow], defects)
check('重复对账不重复产生缺陷', defectsAgain.length === 1)

// 6) 复测一致后，待处理的自动缺陷撤回
const fixed = applyOutcome({
  ...mismatchRow,
  采集记录: [
    { round: 1, siteValue: '0.9s', ledgerValue: '0.6s', checker: '王五', date: '2026-09-05', retest: false },
    { round: 2, siteValue: '0.6s', ledgerValue: '0.6s', checker: '王五', date: '2026-09-07', retest: true },
  ],
})
check('复测后结论一致', fixed.status === '核对一致')
const afterFix = reconcileDefects([fixed], defects)
check('复测一致撤回待处理缺陷', afterFix.length === 0)

// 7) 已在处理中的缺陷不因复测一致被删除
const inProgress: EntryRow = {
  id: 100,
  status: '处理中',
  pending: true,
  abnormal: true,
  缺陷编号: 'DEFE-0999',
  缺陷设备: 'D2',
  缺陷状态: '处理中',
  来源模块: 'SETTINGCHECK:SETT-X2',
}
check('处理中缺陷保留', reconcileDefects([fixed], [inProgress]).length === 1)

// 8) 待核对 / 核对中不产生缺陷
const pendingRow: EntryRow = {
  id: 3,
  status: '待核对',
  pending: true,
  abnormal: false,
  核对编号: 'SETT-X3',
  装置名称: 'D3',
  现场定值: '',
  台账定值: '1A',
  采集记录: [],
}
check('未出结论不产生缺陷', reconcileDefects([pendingRow], []).length === 0)
check('未采集时结论为待核对', deriveCheckOutcome(pendingRow).status === '待核对')

// 9) 消缺后又复测不符：重新打开一条（不新增）
const closed: EntryRow = {
  id: 101,
  status: '已消除',
  pending: false,
  abnormal: false,
  缺陷编号: 'DEFE-0002',
  缺陷设备: 'D2',
  缺陷状态: '已消除',
  来源模块: 'SETTINGCHECK:SETT-X2',
}
const reopened = reconcileDefects([mismatchRow], [closed])
check('消缺后复测不符只重开一条', reopened.length === 1 && reopened[0].status === '待处理')

console.log(`\n${passed} checks passed`)
