import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'
import {
  DEFECT_KEY,
  SETTING_CHECK_KEY,
  backfillSettingCheck,
  reconcileDefects,
} from '@/domain/setting-check'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'substation-protection:entries'
// 结论判定收归共用实现后，存量数据需要按采集顺序回填一遍，版本号驱动只做一次。
const VERSION_KEY = 'substation-protection:version'
const CURRENT_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 存量迁移：核对记录的状态/结论全部由共用判定重算（复测以最后一次采集为准），
 * 然后把不符记录与缺陷处置待处理清单对账一遍。
 */
function migrate(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const checkRows = backfillSettingCheck(data[SETTING_CHECK_KEY] ?? [])
  const defectRows = reconcileDefects(checkRows, data[DEFECT_KEY] ?? [])
  return { ...data, [SETTING_CHECK_KEY]: checkRows, [DEFECT_KEY]: defectRows }
}

function persist(data: Record<string, EntryRow[]>, storage: { setItem(k: string, v: string): void }): Record<string, EntryRow[]> {
  storage.setItem(STORAGE_KEY, JSON.stringify(data))
  storage.setItem(VERSION_KEY, String(CURRENT_VERSION))
  return data
}

function seedStorage(storage?: { setItem(k: string, v: string): void }): Record<string, EntryRow[]> {
  const seeded = clone(SEED_ROWS)
  if (!storage) {
    return seeded
  }
  // 首次播种也要过一遍存量迁移，保证首次进入页面时结论与缺陷清单就是统一判定的结果。
  const migrated = migrate(seeded)
  return persist(migrated, storage)
}

function readStorage(): Record<string, EntryRow[]> {
  const storage = typeof window !== 'undefined' ? window.localStorage : undefined
  if (!storage) {
    return clone(SEED_ROWS)
  }
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) {
    return seedStorage(storage)
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...clone(SEED_ROWS), ...parsed }
    const version = Number(storage.getItem(VERSION_KEY) ?? '1')
    if (version < CURRENT_VERSION) {
      return persist(migrate(merged), storage)
    }
    return merged
  } catch {
    return seedStorage(storage)
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  // 重置出来的种子数据同样过一遍共用判定，避免页面/导出出现两套结论。
  if (key === SETTING_CHECK_KEY) {
    const checkRows = backfillSettingCheck(rows)
    saveRows(SETTING_CHECK_KEY, checkRows)
    saveRows(DEFECT_KEY, reconcileDefects(checkRows, listRows(DEFECT_KEY)))
    return checkRows
  }
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
