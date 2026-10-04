<template>
  <section class="page" data-module="settingcheck">
    <header class="page-head">
      <div>
        <h2>定值核对管理</h2>
        <p class="page-desc">维护核对记录与复测，核对结论以采集顺序最后一次现场定值统一判定，列表、导出清单与核对单共用一套结论。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记核对单</button>
        <button class="btn" type="button" @click="exportRows">导出定值核对清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>核对结论</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ display(row, column) }}</td>
          <td :class="verdictOf(row).match ? 'conclusion-match' : 'conclusion-mismatch'">
            {{ verdictOf(row).text || '待核对' }}
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">核对单</button>
            <button class="link" type="button" @click="openRetest(row)">复测</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无定值核对数据，可先登记核对单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条定值核对记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <CheckSheetDrawer
      v-if="drawerOpen"
      :source="drawerSource"
      :readonly="drawerReadonly"
      @close="closeDrawer"
      @submitted="onSubmitted"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  FIELD_CHECKER,
  FIELD_CODE,
  FIELD_DATE,
  FIELD_DEVICE,
  FIELD_LEDGER,
  FIELD_SITE,
  FIELD_SUBSTATION,
  STATUS_CHECKING,
  STATUS_MATCH,
  STATUS_MISMATCH,
  STATUS_PENDING,
  downloadCheckList,
  evaluateCheck,
  listChecks,
  type CheckVerdict,
} from '@/domain/settingcheck'
import type { EntryRow } from '@/data/types'
import CheckSheetDrawer from './CheckSheetDrawer.vue'

const columns = ['核对编号', '所属变电站', '装置名称', '现场定值', '台账定值', '核对人', '核对日期']
const filterFields = columns.slice(0, 3)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})

const drawerOpen = ref(false)
const drawerSource = ref<EntryRow | null>(null)
const drawerReadonly = ref(false)

const verdictCache = computed(() => {
  const map = new Map<number, CheckVerdict>()
  for (const row of rows.value) {
    map.set(Number(row.id), evaluateCheck(row))
  }
  return map
})

const stats = computed(() => [
  { label: '待核对装置', value: rows.value.filter((row) => String(row.status) === STATUS_PENDING).length },
  { label: '核对一致装置', value: rows.value.filter((row) => String(row.status) === STATUS_MATCH).length },
  { label: '核对不符装置', value: rows.value.filter((row) => String(row.status) === STATUS_MISMATCH).length },
])

const statusSummary = computed(() =>
  [STATUS_PENDING, STATUS_CHECKING, STATUS_MATCH, STATUS_MISMATCH].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const FIELD_BY_COLUMN: Record<string, string> = {
  核对编号: FIELD_CODE,
  所属变电站: FIELD_SUBSTATION,
  装置名称: FIELD_DEVICE,
  现场定值: FIELD_SITE,
  台账定值: FIELD_LEDGER,
  核对人: FIELD_CHECKER,
  核对日期: FIELD_DATE,
}

function verdictOf(row: EntryRow): CheckVerdict {
  return verdictCache.value.get(Number(row.id)) ?? evaluateCheck(row)
}

// 现场定值、台账定值、核对人、核对日期均以最后一次采集（复测）为准。
function display(row: EntryRow, column: string): string {
  const verdict = verdictOf(row)
  if (column === FIELD_SITE) {
    return verdict.latest?.siteValue || String(row[FIELD_SITE] ?? '')
  }
  if (column === FIELD_LEDGER) {
    return verdict.latest?.ledgerValue || String(row[FIELD_LEDGER] ?? '')
  }
  if (column === FIELD_CHECKER) {
    return verdict.latest?.checker || String(row[FIELD_CHECKER] ?? '')
  }
  if (column === FIELD_DATE) {
    return verdict.latest?.collectedAt || String(row[FIELD_DATE] ?? '')
  }
  return String(row[FIELD_BY_COLUMN[column]] ?? '—')
}

function matches(row: EntryRow): boolean {
  return filterFields.every((field) => {
    const keyword = filters.value[field]?.trim()
    if (!keyword) {
      return true
    }
    return display(row, field).includes(keyword)
  })
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  errorMessage.value = ''
  try {
    downloadCheckList()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '定值核对清单导出失败'
  }
}

function openCreate() {
  drawerSource.value = null
  drawerReadonly.value = false
  drawerOpen.value = true
}

function openDetail(row: EntryRow) {
  drawerSource.value = row
  drawerReadonly.value = true
  drawerOpen.value = true
}

function openRetest(row: EntryRow) {
  drawerSource.value = row
  drawerReadonly.value = false
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
  drawerSource.value = null
  errorMessage.value = ''
}

function onSubmitted(message: string) {
  drawerOpen.value = false
  drawerSource.value = null
  reload()
  noticeMessage.value = message
}

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    rows.value = listChecks().filter(matches)
    total.value = rows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '定值核对列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.conclusion-match { color: #027a48; }
.conclusion-mismatch { color: #b42318; }
.notice-text { color: #027a48; }
</style>
