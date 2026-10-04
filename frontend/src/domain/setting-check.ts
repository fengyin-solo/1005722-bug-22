import type { EntryRow } from '@/data/types'

/**
 * 定值核对的唯一判定实现。
 * 列表页、导出清单、核对单、详情抽屉四处都从这里取核对结论，
 * 不允许任何入口再自己按状态或差值另判一套。
 */

export const SETTING_CHECK_KEY = 'settingcheck'
export const DEFECT_KEY = 'defect'

export const STATUS_PENDING = '待核对'
export const STATUS_CHECKING = '核对中'
export const STATUS_MATCH = '核对一致'
export const STATUS_MISMATCH = '核对不符'

export const FIELD_NO = '核对编号'
export const FIELD_STATION = '所属变电站'
export const FIELD_DEVICE = '装置名称'
export const FIELD_SITE = '现场定值'
export const FIELD_LEDGER = '台账定值'
export const FIELD_CHECKER = '核对人'
export const FIELD_DATE = '核对日期'
export const FIELD_RESULT = '核对结论'

/** 一次现场采集（首次核对或复测都作为一条采集记录，按采集顺序排列）。 */
export type CheckCollection = {
  round: number
  siteValue: string
  ledgerValue: string
  checker: string
  date: string
  retest: boolean
}

export type CheckOutcome = {
  /** 终态状态：待核对 / 核对中 / 核对一致 / 核对不符 */
  status: string
  /** 统一写法的核对结论，以现场定值为准表述 */
  conclusion: string
  /** 结论是否一致 */
  consistent: boolean
  /** 是否已经得出终态结论（拿到现场定值与台账定值后即为 true） */
  decided: boolean
  /** 当前结论基于第几次采集（复测以最后一次为准） */
  round: number
  /** 参与判定的现场定值（统一取最后一次采集） */
  siteValue: string
  ledgerValue: string
}

const TRAILING_ZEROS = /(?:\.0+|(\.\d*?)0+)$/

/** 现场定值写法归一：去空白、去多余正负号与尾随零，使「1.0」与「1」、「 1 A 」与「1A」一致。 */
export function normalizeValue(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/^\+(?=0*\.?\d)/, '')
    .replace(TRAILING_ZEROS, '$1')
}

export function asCollections(row: EntryRow): CheckCollection[] {
  const raw = row.采集记录
  if (!Array.isArray(raw)) {
    return []
  }
  return (raw as unknown[])
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item, index) => ({
      round: Number(item.round) || index + 1,
      siteValue: String(item.siteValue ?? ''),
      ledgerValue: String(item.ledgerValue ?? ''),
      checker: String(item.checker ?? ''),
      date: String(item.date ?? ''),
      retest: Boolean(item.retest),
    }))
    .sort((a, b) => a.round - b.round)
}

/**
 * 唯一的核对结论判定：以现场定值为统一写法依据，
 * 现场定值与台账定值按归一化后的值比较，复测记录只取采集顺序的最后一次。
 */
export function deriveCheckOutcome(row: EntryRow): CheckOutcome {
  const collections = asCollections(row)
  const latest = collections.length ? collections[collections.length - 1] : null

  const siteValue = latest ? latest.siteValue : String(row[FIELD_SITE] ?? '')
  const ledgerValue = latest ? latest.ledgerValue : String(row[FIELD_LEDGER] ?? '')
  const round = latest ? latest.round : 0

  if (!siteValue || !ledgerValue) {
    const checking = Boolean(latest) || String(row.status) === STATUS_CHECKING
    return {
      status: checking ? STATUS_CHECKING : STATUS_PENDING,
      conclusion: '待核对',
      consistent: false,
      decided: false,
      round,
      siteValue,
      ledgerValue,
    }
  }

  const site = normalizeValue(siteValue)
  const ledger = normalizeValue(ledgerValue)
  const consistent = site === ledger

  return {
    status: consistent ? STATUS_MATCH : STATUS_MISMATCH,
    conclusion: consistent
      ? `一致：现场定值 ${siteValue} 与台账定值 ${ledgerValue} 一致`
      : `不符：现场定值 ${siteValue} 与台账定值 ${ledgerValue} 不符，需缺陷处置`,
    consistent,
    decided: true,
    round,
    siteValue,
    ledgerValue,
  }
}

/** 按共用判定回写一条核对记录的状态、结论与待办/异常标记。 */
export function applyOutcome(row: EntryRow): EntryRow {
  const outcome = deriveCheckOutcome(row)
  const latest = asCollections(row).at(-1)
  return {
    ...row,
    status: outcome.status,
    pending: !outcome.decided,
    abnormal: outcome.decided && !outcome.consistent,
    [FIELD_RESULT]: outcome.conclusion,
    [FIELD_SITE]: outcome.siteValue,
    [FIELD_LEDGER]: outcome.ledgerValue,
    ...(latest
      ? {
          [FIELD_CHECKER]: latest.checker || String(row[FIELD_CHECKER] ?? ''),
          [FIELD_DATE]: latest.date || String(row[FIELD_DATE] ?? ''),
        }
      : {}),
    // 兼容旧字段：历史页面/导出里可能仍在读它，与共用结论保持同步。
    核对状态: outcome.status,
  }
}

/** 列表/详情/核对单共用的展示行：结论一律由共用判定计算，不信任存量行里写死的值。 */
export function presentCheckRow(row: EntryRow): EntryRow {
  const outcome = deriveCheckOutcome(row)
  return {
    ...row,
    status: outcome.status,
    [FIELD_RESULT]: outcome.conclusion,
    核对状态: outcome.status,
  }
}

/**
 * 存量核对结论回填（按采集顺序）：
 * 1) 已有状态但没有采集记录的存量行，按其现场定值/台账定值补一条首次采集记录；
 * 2) 结论、状态、待办/异常标记全部重新由共用判定回写，复测以最后一次采集为准。
 */
export function backfillSettingCheck(rows: EntryRow[]): EntryRow[] {
  return rows.map((row) => {
    const collections = asCollections(row)
    if (collections.length === 0) {
      const siteValue = String(row[FIELD_SITE] ?? '')
      const ledgerValue = String(row[FIELD_LEDGER] ?? '')
      if (siteValue || ledgerValue) {
        const seeded: CheckCollection = {
          round: 1,
          siteValue,
          ledgerValue,
          checker: String(row[FIELD_CHECKER] ?? ''),
          date: String(row[FIELD_DATE] ?? ''),
          retest: false,
        }
        return applyOutcome({ ...row, 采集记录: [seeded] })
      }
    }
    return applyOutcome({ ...row, 采集记录: collections })
  })
}

const DEFECT_NO = '缺陷编号'
const DEFECT_DEVICE = '缺陷设备'
const DEFECT_LEVEL = '缺陷等级'
const DEFECT_DESC = '缺陷描述'
const DEFECT_FOUNDER = '发现人'
const DEFECT_DEADLINE = '处理期限'
const DEFECT_HANDLER = '处理人'
const DEFECT_STATUS = '缺陷状态'
const DEFECT_SOURCE_NO = '来源核对编号'
const DEFECT_SOURCE_KEY = '来源模块'

function defectRef(checkNo: string): string {
  return `SETTINGCHECK:${checkNo}`
}

function nextDefectNo(rows: EntryRow[]): string {
  let max = 0
  for (const row of rows) {
    const match = String(row[DEFECT_NO] ?? '').match(/^DEFE-(\d+)$/)
    if (match) {
      max = Math.max(max, Number(match[1]))
    }
  }
  return `DEFE-${String(max + 1).padStart(4, '0')}`
}

function buildDefect(row: EntryRow, outcome: CheckOutcome, id: number): EntryRow {
  const checkNo = String(row[FIELD_NO] ?? '')
  return {
    id,
    status: '待处理',
    pending: true,
    abnormal: true,
    // 编号在落库时由 nextDefectNo 统一分配，保证 DEFE-#### 不重号。
    [DEFECT_NO]: '',
    [DEFECT_DEVICE]: String(row[FIELD_DEVICE] ?? ''),
    [DEFECT_LEVEL]: '一般',
    [DEFECT_DESC]: `定值核对不符：${String(row[FIELD_STATION] ?? '')} ${String(
      row[FIELD_DEVICE] ?? '',
    )}，现场定值 ${outcome.siteValue} 与台账定值 ${outcome.ledgerValue} 不符（核对单 ${checkNo}）`,
    [DEFECT_FOUNDER]: String(row[FIELD_CHECKER] ?? ''),
    [DEFECT_DEADLINE]: '',
    [DEFECT_HANDLER]: '',
    [DEFECT_STATUS]: '待处理',
    [DEFECT_SOURCE_KEY]: defectRef(checkNo),
  }
}

/**
 * 核对结论与缺陷处置待处理清单对账：
 * - 判定不符的核对记录，保证缺陷待处理清单里恰有一条对应缺陷（重复回填不重复产生）；
 * - 复测后一致的，撤回此前自动产生、且仍处于待处理的缺陷；已在处理/已消除的不动。
 */
export function reconcileDefects(checkRows: EntryRow[], defectRows: EntryRow[]): EntryRow[] {
  const byRef = new Map<string, EntryRow>()
  for (const defect of defectRows) {
    const ref = String(defect[DEFECT_SOURCE_KEY] ?? '')
    if (ref && !byRef.has(ref)) {
      byRef.set(ref, defect)
    }
  }

  const result = [...defectRows]
  const pendingAdds: EntryRow[] = []
  let nextId = result.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0)

  for (const check of checkRows) {
    const checkNo = String(check[FIELD_NO] ?? '')
    const ref = defectRef(checkNo)
    const outcome = deriveCheckOutcome(check)
    const existing = byRef.get(ref)

    if (outcome.decided && !outcome.consistent) {
      if (!existing) {
        pendingAdds.push(buildDefect(check, outcome, nextId + 1))
        nextId += 1
      } else if (String(existing.status) === '已消除' || String(existing.status) === '已升级') {
        // 曾经消缺、复测又不符：重新升级为待处理，仍只保留一条。
        const reopened: EntryRow = {
          ...existing,
          status: '待处理',
          pending: true,
          abnormal: true,
          [DEFECT_STATUS]: '待处理',
          [DEFECT_DESC]: `定值核对不符：${String(check[FIELD_STATION] ?? '')} ${String(
            check[FIELD_DEVICE] ?? '',
          )}，现场定值 ${outcome.siteValue} 与台账定值 ${outcome.ledgerValue} 不符（核对单 ${checkNo}，复测不符）`,
        }
        const index = result.findIndex((item) => item.id === existing.id)
        if (index >= 0) {
          result[index] = reopened
        }
      }
    } else if (outcome.decided && outcome.consistent && existing) {
      if (String(existing.status) === '待处理') {
        const index = result.findIndex((item) => item.id === existing.id)
        if (index >= 0) {
          result.splice(index, 1)
        }
        byRef.delete(ref)
      }
    }
  }

  for (const defect of pendingAdds) {
    defect[DEFECT_NO] = nextDefectNo(result)
    result.push(defect)
  }
  return result
}
