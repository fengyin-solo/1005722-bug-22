import {
  FIELD_CHECKER,
  FIELD_DATE,
  FIELD_DEVICE,
  FIELD_LEDGER,
  FIELD_NO,
  FIELD_RESULT,
  FIELD_SITE,
  FIELD_STATION,
  SETTING_CHECK_KEY,
  DEFECT_KEY,
  STATUS_CHECKING,
  STATUS_MATCH,
  STATUS_MISMATCH,
  STATUS_PENDING,
  applyOutcome,
  asCollections,
  deriveCheckOutcome,
  presentCheckRow,
  reconcileDefects,
  type CheckCollection,
} from '@/domain/setting-check'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

/**
 * 定值核对的三个入口（列表、导出、核对单/详情抽屉）统一走这里取数，
 * 核对结论只能来自 domain/setting-check 的共用判定。
 */

export type CheckSheetForm = {
  checkNo: string
  station: string
  device: string
  siteValue: string
  ledgerValue: string
  checker: string
  date: string
  /** 勾选表示本次提交是复测（现场定值与上一次相同也强制追加一条采集记录）。 */
  retest: boolean
}

export type CheckSheetResult = ActionResult & { id?: number }

const EXPORT_HEADER = [
  '编号',
  FIELD_NO,
  FIELD_STATION,
  FIELD_DEVICE,
  FIELD_SITE,
  FIELD_LEDGER,
  FIELD_CHECKER,
  FIELD_DATE,
  '当前状态',
  FIELD_RESULT,
]

function csvEscape(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 列表入口：过滤与结论都取共用实现。 */
export function listCheckRows(filters: Record<string, string> = {}): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  return listRows(SETTING_CHECK_KEY)
    .map(presentCheckRow)
    .filter((row) =>
      pairs.every(([field, value]) =>
        String(row[field] ?? '').includes(value.trim()),
      ),
    )
}

/** 导出入口：核对人等列全量保留，结论与状态取共用判定（不再按差值另判）。 */
export function exportCheckRows(): { filename: string; content: string } {
  const lines = [EXPORT_HEADER.join(',')]
  for (const row of listRows(SETTING_CHECK_KEY)) {
    const presented = presentCheckRow(row)
    lines.push(
      [
        presented.id,
        presented[FIELD_NO],
        presented[FIELD_STATION],
        presented[FIELD_DEVICE],
        presented[FIELD_SITE],
        presented[FIELD_LEDGER],
        presented[FIELD_CHECKER],
        presented[FIELD_DATE],
        presented.status,
        presented[FIELD_RESULT],
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  return { filename: '定值核对-清单.csv', content: `﻿${lines.join('\n')}` }
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/**
 * 核对单提交（登记与复测同一入口）：
 * - 同一张核对单（核对编号相同）重复提交只留一条，更新原记录而不是新增；
 * - 每次提交追加一条采集记录，复测判定以采集顺序的最后一次为准；
 * - 结论由共用判定统一回写，不符的自动落到缺陷处置待处理清单。
 */
export function submitCheckSheet(form: CheckSheetForm): CheckSheetResult {
  const checkNo = form.checkNo.trim()
  if (!checkNo) {
    return { ok: false, message: '请填写核对编号' }
  }
  if (!form.device.trim()) {
    return { ok: false, message: '请填写装置名称' }
  }

  const rows = [...listRows(SETTING_CHECK_KEY)]
  let index = rows.findIndex((row) => String(row[FIELD_NO] ?? '') === checkNo)
  let row: EntryRow
  if (index < 0) {
    row = {
      id: nextId(rows),
      status: STATUS_PENDING,
      pending: true,
      abnormal: false,
      [FIELD_NO]: checkNo,
      [FIELD_STATION]: form.station.trim(),
      [FIELD_DEVICE]: form.device.trim(),
      [FIELD_SITE]: '',
      [FIELD_LEDGER]: form.ledgerValue.trim(),
      [FIELD_CHECKER]: form.checker.trim(),
      [FIELD_DATE]: form.date || today(),
      [FIELD_RESULT]: '待核对',
      核对状态: STATUS_PENDING,
      采集记录: [],
    }
    index = rows.length
  } else {
    row = { ...rows[index] }
  }

  const collections = asCollections(row)
  const last = collections.at(-1)
  const siteValue = form.siteValue.trim()
  const ledgerValue = form.ledgerValue.trim()
  const checker = form.checker.trim()
  const date = form.date || today()

  // 对已有核对单：现场定值/台账定值/核对人/日期变化即视为一次复测采集，追加到采集序列末尾；
  // 数值完全相同的重复提交默认不追加，勾选「本次为复测」可强制追加一条；
  // 无论哪种情况同一张核对单（核对编号相同）始终只保留一条记录。
  const changed =
    last === undefined ||
    last.siteValue !== siteValue ||
    last.ledgerValue !== ledgerValue ||
    last.checker !== checker ||
    last.date !== date ||
    form.retest

  if (siteValue && changed) {
    const collection: CheckCollection = {
      round: (last?.round ?? 0) + 1,
      siteValue,
      ledgerValue,
      checker,
      date,
      retest: last !== undefined || form.retest,
    }
    collections.push(collection)
  }

  const next: EntryRow = applyOutcome({
    ...row,
    // 已提交核对单但现场定值尚未采集：进入核对中（applyOutcome 会据此保留该状态）。
    status: siteValue ? row.status : STATUS_CHECKING,
    [FIELD_STATION]: form.station.trim() || String(row[FIELD_STATION] ?? ''),
    [FIELD_DEVICE]: form.device.trim(),
    ...(ledgerValue ? { [FIELD_LEDGER]: ledgerValue } : {}),
    ...(checker ? { [FIELD_CHECKER]: checker } : {}),
    [FIELD_DATE]: date,
    采集记录: collections,
  })

  rows[index] = next
  saveRows(SETTING_CHECK_KEY, rows)

  // 不符结论落缺陷处置待处理清单；复测一致会撤回仍待处理的自动缺陷。
  saveRows(DEFECT_KEY, reconcileDefects(rows, listRows(DEFECT_KEY)))

  const outcome = deriveCheckOutcome(next)
  const message = outcome.decided
    ? outcome.consistent
      ? `核对单 ${checkNo} 已提交，结论：${outcome.conclusion}`
      : `核对单 ${checkNo} 已提交，结论不符，已转入缺陷处置待处理清单`
    : `核对单 ${checkNo} 已保存，现场定值尚未采集，状态「${STATUS_CHECKING}」`

  return { ok: true, message, id: Number(next.id) }
}

/** 开始核对：待核对 → 核对中（仅状态流转，结论仍由共用判定给）。 */
export function startCheck(id: number): ActionResult {
  const rows = [...listRows(SETTING_CHECK_KEY)]
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的核对记录` }
  }
  const current = deriveCheckOutcome(rows[index])
  if (current.status !== STATUS_PENDING) {
    return { ok: false, message: `核对单当前为「${current.status}」，不能重复开始核对` }
  }
  const next: EntryRow = {
    ...rows[index],
    status: STATUS_CHECKING,
    pending: true,
    abnormal: false,
    [FIELD_RESULT]: '待核对',
    核对状态: STATUS_CHECKING,
  }
  rows[index] = next
  saveRows(SETTING_CHECK_KEY, rows)
  return { ok: true, message: '核对单已进入核对中，请在核对单中录入现场定值' }
}

export function downloadCheckRows(): void {
  const { filename, content } = exportCheckRows()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export const CONCLUSION_STATS = [
  { label: '待核对装置', match: STATUS_PENDING },
  { label: '核对中装置', match: STATUS_CHECKING },
  { label: '核对一致装置', match: STATUS_MATCH },
  { label: '核对不符装置', match: STATUS_MISMATCH },
]
