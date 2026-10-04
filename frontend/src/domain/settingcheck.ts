import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 定值核对的唯一事实来源：列表页、导出清单、核对单/详情抽屉都从这里取核对结论，
// 不再各自按状态或差值另判一套。

export const SETTINGCHECK_KEY = 'settingcheck'
export const DEFECT_KEY = 'defect'

export const FIELD_CODE = '核对编号'
export const FIELD_SUBSTATION = '所属变电站'
export const FIELD_DEVICE = '装置名称'
export const FIELD_SITE = '现场定值'
export const FIELD_LEDGER = '台账定值'
export const FIELD_CHECKER = '核对人'
export const FIELD_DATE = '核对日期'
export const FIELD_STATE = '核对状态'
/** 采集记录（含复测）按采集顺序存放，结论永远以最后一次现场定值为准。 */
export const FIELD_SAMPLES = '采集记录'
export const FIELD_CONCLUSION = '核对结论'

export const STATUS_PENDING = '待核对'
export const STATUS_CHECKING = '核对中'
export const STATUS_MATCH = '核对一致'
export const STATUS_MISMATCH = '核对不符'

/** 判定不符自动登记到缺陷处置时打在缺陷上的来源标记，也是回补时的幂等键。 */
export const DEFECT_SOURCE_TAG = '定值核对'

const MIGRATION_KEY = 'substation-protection:settingcheck-migration'
const MIGRATION_VERSION = 'v1-unified-verdict'

// 一次现场采集（首测或复测）的结构化记录。
export type SettingSample = {
  round: number
  siteValue: string
  ledgerValue: string
  checker: string
  collectedAt: string
}

export type CheckVerdict = {
  match: boolean
  /** 统一以现场定值起头的结论文案，三处入口共用。 */
  text: string
  latest: SettingSample | null
  samples: SettingSample[]
}

export type SubmitCheckInput = {
  [FIELD_CODE]: string
  [FIELD_SUBSTATION]?: string
  [FIELD_DEVICE]?: string
  [FIELD_SITE]: string
  [FIELD_LEDGER]?: string
  [FIELD_CHECKER]?: string
  [FIELD_DATE]?: string
}

function textOf(value: unknown): string {
  return String(value ?? '').trim()
}

/** 数值型定值按数值+单位比较（如 5.0A / 5A 视为一致，5A 与 5Ω 不算），其余按归一化文本比较。 */
function normalizeValue(raw: string): { numeric: boolean; value: number; unit: string; text: string } {
  const text = raw.replace(/\s+/g, '')
  const matched = text.match(/^[-+]?\d+(?:\.\d+)?/)
  if (matched && /^[^\d]*$/.test(text.slice(matched[0].length))) {
    return { numeric: true, value: Number(matched[0]), unit: text.slice(matched[0].length), text }
  }
  return { numeric: false, value: Number.NaN, unit: '', text }
}

export function valuesEqual(left: string, right: string): boolean {
  if (left.trim() === '' && right.trim() === '') {
    return true
  }
  const a = normalizeValue(left)
  const b = normalizeValue(right)
  if (a.numeric && b.numeric) {
    return Math.abs(a.value - b.value) < 1e-9 && a.unit === b.unit
  }
  return a.text === b.text
}

export function parseSamples(row: EntryRow): SettingSample[] {
  const raw = row[FIELD_SAMPLES]
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as Partial<SettingSample>[]
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item) => item && textOf(item.siteValue) !== '')
          .map((item, index) => ({
            round: Number(item.round) || index + 1,
            siteValue: textOf(item.siteValue),
            ledgerValue: textOf(item.ledgerValue),
            checker: textOf(item.checker),
            collectedAt: textOf(item.collectedAt),
          }))
      }
    } catch {
      // 落库内容损坏时退化为按行内字段补一条，不让结论算不出来。
    }
  }
  // 兼容没有采集记录的存量记录：把行内现场定值当作第一次采集。
  const siteValue = textOf(row[FIELD_SITE])
  if (siteValue === '') {
    return []
  }
  return [
    {
      round: 1,
      siteValue,
      ledgerValue: textOf(row[FIELD_LEDGER]),
      checker: textOf(row[FIELD_CHECKER]),
      collectedAt: textOf(row[FIELD_DATE]),
    },
  ]
}

export function serializeSamples(samples: SettingSample[]): string {
  return JSON.stringify(samples)
}

/** 结论按现场定值统一写法：现场定值××，台账定值××，核对一致/不符。 */
export function buildConclusionText(siteValue: string, ledgerValue: string, match: boolean): string {
  const tail = match ? '核对一致' : '核对不符'
  return `现场定值 ${siteValue}，台账定值 ${ledgerValue}，${tail}`
}

/** 核对结论的唯一计算入口：以采集顺序最后一次现场定值（复测值）判定。 */
export function evaluateCheck(row: EntryRow): CheckVerdict {
  const samples = parseSamples(row)
  const latest = samples.length ? samples[samples.length - 1] : null
  const siteValue = latest ? latest.siteValue : textOf(row[FIELD_SITE])
  const ledgerValue = latest ? latest.ledgerValue : textOf(row[FIELD_LEDGER])
  const hasValue = siteValue !== '' || ledgerValue !== ''
  const match = hasValue ? valuesEqual(siteValue, ledgerValue) : false
  return {
    match,
    text: latest ? buildConclusionText(siteValue, ledgerValue, match) : '',
    latest,
    samples,
  }
}

export function statusOfVerdict(verdict: CheckVerdict): string {
  if (!verdict.latest) {
    return STATUS_PENDING
  }
  return verdict.match ? STATUS_MATCH : STATUS_MISMATCH
}

export function listChecks(): EntryRow[] {
  return listRows(SETTINGCHECK_KEY)
}

export function getCheck(id: number): EntryRow | undefined {
  return listChecks().find((row) => Number(row.id) === id)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function buildDefect(check: EntryRow, verdict: CheckVerdict): EntryRow {
  const code = textOf(check[FIELD_CODE])
  const latest = verdict.latest
  const device = textOf(check[FIELD_DEVICE])
  return {
    id: nextId(listRows(DEFECT_KEY)),
    status: '待处理',
    pending: true,
    abnormal: true,
    缺陷编号: code,
    缺陷设备: device,
    缺陷等级: '一般',
    缺陷描述: `定值核对不符：${verdict.text}`,
    发现人: latest?.checker || textOf(check[FIELD_CHECKER]),
    处理期限: '',
    处理人: '',
    缺陷状态: '待处理',
    来源: DEFECT_SOURCE_TAG,
    来源编号: code,
  }
}

/**
 * 判定不符的结论落到缺陷处置「待处理」清单；复测转一致则回收仍待处理的联动缺陷。
 * 同一核对单只保留一条联动缺陷（按来源编号幂等），人工已处理的不动。
 */
export function syncDefect(check: EntryRow, verdict: CheckVerdict): void {
  const defects = listRows(DEFECT_KEY)
  const code = textOf(check[FIELD_CODE])
  const linkedIndex = defects.findIndex(
    (row) =>
      textOf(row['来源']) === DEFECT_SOURCE_TAG && textOf(row['来源编号']) === code,
  )

  if (verdict.latest && !verdict.match) {
    if (linkedIndex < 0) {
      saveRows(DEFECT_KEY, [...defects, buildDefect(check, verdict)])
    } else {
      const linked = defects[linkedIndex]
      const refreshed: EntryRow = {
        ...linked,
        缺陷描述: `定值核对不符：${verdict.text}`,
        发现人: verdict.latest.checker || textOf(linked['发现人']),
      }
      // 只有仍在待处理时才刷新状态，已经进入处置流程的不回退。
      if (textOf(linked.status) === '待处理') {
        refreshed.status = '待处理'
        refreshed.pending = true
        refreshed.abnormal = true
        refreshed['缺陷状态'] = '待处理'
      }
      const next = [...defects]
      next[linkedIndex] = refreshed
      saveRows(DEFECT_KEY, next)
    }
    return
  }

  if (linkedIndex >= 0 && textOf(defects[linkedIndex].status) === '待处理') {
    saveRows(DEFECT_KEY, defects.filter((_, index) => index !== linkedIndex))
  }
}

function applyVerdict(row: EntryRow): EntryRow {
  const verdict = evaluateCheck(row)
  const status = statusOfVerdict(verdict)
  const latest = verdict.latest
  return {
    ...row,
    status,
    pending: status !== STATUS_MATCH && status !== STATUS_MISMATCH,
    abnormal: status === STATUS_MISMATCH,
    [FIELD_SITE]: latest ? latest.siteValue : textOf(row[FIELD_SITE]),
    [FIELD_LEDGER]: latest ? latest.ledgerValue : textOf(row[FIELD_LEDGER]),
    [FIELD_CHECKER]: latest?.checker || textOf(row[FIELD_CHECKER]),
    [FIELD_DATE]: latest?.collectedAt || textOf(row[FIELD_DATE]),
    [FIELD_SAMPLES]: serializeSamples(verdict.samples),
    [FIELD_CONCLUSION]: verdict.text,
  }
}

/**
 * 核对单提交（首份与复测同一个入口）：同一核对编号只留一条，
 * 复测把新现场值追加为下一次采集，结论以最后一次采集为准。
 */
export function submitCheck(input: SubmitCheckInput): ActionResult & { id?: number } {
  const code = textOf(input[FIELD_CODE])
  if (!code) {
    return { ok: false, message: '核对编号不能为空，同一张核对单按编号去重' }
  }
  const siteValue = textOf(input[FIELD_SITE])
  if (!siteValue) {
    return { ok: false, message: '现场定值不能为空，核对结论按现场定值统一判定' }
  }

  const rows = listChecks()
  const index = rows.findIndex((row) => textOf(row[FIELD_CODE]) === code)
  const now = new Date().toISOString().slice(0, 10)
  const checker = textOf(input[FIELD_CHECKER])
  const ledgerValue = textOf(input[FIELD_LEDGER])
  const collectedAt = textOf(input[FIELD_DATE]) || now

  let saved: EntryRow
  if (index < 0) {
    const base: EntryRow = {
      id: nextId(rows),
      status: STATUS_CHECKING,
      pending: true,
      abnormal: false,
      [FIELD_CODE]: code,
      [FIELD_SUBSTATION]: textOf(input[FIELD_SUBSTATION]),
      [FIELD_DEVICE]: textOf(input[FIELD_DEVICE]),
      [FIELD_SITE]: siteValue,
      [FIELD_LEDGER]: ledgerValue,
      [FIELD_CHECKER]: checker,
      [FIELD_DATE]: collectedAt,
      [FIELD_STATE]: '',
      [FIELD_SAMPLES]: '',
      [FIELD_CONCLUSION]: '',
    }
    const samples: SettingSample[] = [
      { round: 1, siteValue, ledgerValue, checker, collectedAt },
    ]
    base[FIELD_SAMPLES] = serializeSamples(samples)
    saved = applyVerdict(base)
    saveRows(SETTINGCHECK_KEY, [...rows, saved])
  } else {
    const existing = rows[index]
    const samples = parseSamples(existing)
    samples.push({
      round: samples.length + 1,
      siteValue,
      ledgerValue: ledgerValue || (samples.length ? samples[samples.length - 1].ledgerValue : ''),
      checker: checker || (samples.length ? samples[samples.length - 1].checker : ''),
      collectedAt,
    })
    const merged: EntryRow = {
      ...existing,
      [FIELD_SUBSTATION]: textOf(input[FIELD_SUBSTATION]) || textOf(existing[FIELD_SUBSTATION]),
      [FIELD_DEVICE]: textOf(input[FIELD_DEVICE]) || textOf(existing[FIELD_DEVICE]),
      [FIELD_SAMPLES]: serializeSamples(samples),
    }
    if (ledgerValue) {
      merged[FIELD_LEDGER] = ledgerValue
    }
    saved = applyVerdict(merged)
    const next = [...rows]
    next[index] = saved
    saveRows(SETTINGCHECK_KEY, next)
  }

  const verdict = evaluateCheck(saved)
  syncDefect(saved, verdict)
  return {
    ok: true,
    id: Number(saved.id),
    message:
      verdict.samples.length > 1
        ? `复测已记录（第 ${verdict.samples.length} 次采集），结论：${verdict.text}`
        : `核对单已提交，结论：${verdict.text}`,
  }
}

/**
 * 存量核对结论按采集顺序回填：对每条既有核对记录重算结论与状态，
 * 再按结论同步缺陷处置清单。返回回填条数。
 */
export function backfillConclusions(): number {
  const rows = listChecks()
  if (!rows.length) {
    return 0
  }
  const backfilled = rows
    .slice()
    .sort((a, b) => {
      const sa = parseSamples(a)[0]
      const sb = parseSamples(b)[0]
      const ta = sa?.collectedAt || textOf(a[FIELD_DATE])
      const tb = sb?.collectedAt || textOf(b[FIELD_DATE])
      if (ta !== tb) {
        return ta < tb ? -1 : 1
      }
      return Number(a.id) - Number(b.id)
    })
    .map(applyVerdict)

  // 回填可能重排了顺序，按原 id 顺序落库，只改内容。
  const byId = new Map(backfilled.map((row) => [Number(row.id), row]))
  const next = rows.map((row) => byId.get(Number(row.id)) ?? row)
  saveRows(SETTINGCHECK_KEY, next)

  for (const row of next) {
    syncDefect(row, evaluateCheck(row))
  }
  return next.length
}

/**
 * 一次性存量迁移：兼容三套判定并存时落下的核对记录——
 * 把行内现场定值补成第一次采集（若缺失），再按采集顺序统一回填核对结论。
 * 通过 localStorage 版本标记保证只跑一遍，后续提交不再重复回填。
 */
export function migrateSettingChecks(): number {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 0
  }
  if (window.localStorage.getItem(MIGRATION_KEY) === MIGRATION_VERSION) {
    return 0
  }
  const rows = listChecks()
  let touched = false
  const next = rows.map((row) => {
    const samples = parseSamples(row)
    // 旧记录可能行内现场定值为空但已经走过状态流转（确认一致/标记不符），
    // 这类无法重算现场值，保留结论原文、不伪造采集。
    if (!samples.length) {
      const legacy = textOf(row[FIELD_CONCLUSION])
      return {
        ...row,
        [FIELD_SAMPLES]: serializeSamples([]),
        [FIELD_CONCLUSION]: legacy,
      }
    }
    if (textOf(row[FIELD_SAMPLES]).startsWith('[')) {
      return row
    }
    touched = true
    return { ...row, [FIELD_SAMPLES]: serializeSamples(samples) }
  })
  if (touched) {
    saveRows(SETTINGCHECK_KEY, next)
  }
  const count = backfillConclusions()
  window.localStorage.setItem(MIGRATION_KEY, MIGRATION_VERSION)
  return count
}

/** 导出清单的行数据：结论、现场/台账定值、核对人全部取自同一份判定结果。 */
export function exportCheckRows(): { header: string[]; lines: string[][] } {
  const header = [
    '编号',
    FIELD_CODE,
    FIELD_SUBSTATION,
    FIELD_DEVICE,
    FIELD_SITE,
    FIELD_LEDGER,
    FIELD_CHECKER,
    FIELD_DATE,
    FIELD_STATE,
    FIELD_CONCLUSION,
    '当前状态',
  ]
  const lines = listChecks().map((row) => {
    const verdict = evaluateCheck(row)
    const latest = verdict.latest
    return [
      String(row.id),
      textOf(row[FIELD_CODE]),
      textOf(row[FIELD_SUBSTATION]),
      textOf(row[FIELD_DEVICE]),
      latest ? latest.siteValue : textOf(row[FIELD_SITE]),
      latest ? latest.ledgerValue : textOf(row[FIELD_LEDGER]),
      latest?.checker || textOf(row[FIELD_CHECKER]),
      latest?.collectedAt || textOf(row[FIELD_DATE]),
      textOf(row[FIELD_STATE]),
      verdict.text,
      statusOfVerdict(verdict),
    ]
  })
  return { header, lines }
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** 导出清单入口：与列表、核对单同源，核对人随复测记录取，不会再整列丢失。 */
export function downloadCheckList(): void {
  const { header, lines } = exportCheckRows()
  const bom = String.fromCharCode(0xfeff)
  const content = `${bom}${[header, ...lines]
    .map((line) => line.map(csvCell).join(','))
    .join('\n')}`
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = '定值核对-清单.csv'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
