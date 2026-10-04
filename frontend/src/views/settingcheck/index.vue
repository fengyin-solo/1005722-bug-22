<template>
  <section class="page" data-module="settingcheck">
    <header class="page-head">
      <div>
        <h2>定值核对管理</h2>
        <p class="page-desc">登记核对单并按现场定值统一判定核对结论；列表、导出清单、核对单与详情抽屉共用同一套判定，复测以最后一次采集为准。</p>
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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无定值核对数据，可先登记核对单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条定值核对记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="lastMessage" class="success-text">{{ lastMessage }}</span>
    </footer>

    <CheckSheetDialog
      :open="sheetOpen"
      :row="sheetRow"
      @close="sheetOpen = false"
      @submitted="onSubmitted"
    />
    <CheckDetailDrawer
      :open="drawerOpen"
      :row="drawerRow"
      @close="drawerOpen = false"
      @retest="openSheet(drawerRow)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import CheckSheetDialog from './CheckSheetDialog.vue'
import CheckDetailDrawer from './CheckDetailDrawer.vue'
import {
  CONCLUSION_STATS,
  downloadCheckRows,
  listCheckRows,
  startCheck,
} from '@/api/setting-check-service'
import { STATUS_PENDING } from '@/domain/setting-check'
import type { EntryRow } from '@/data/types'

// 列表展示列：核对结论是判定产物，三个入口都不再各自计算。
const columns = ['核对编号', '所属变电站', '装置名称', '现场定值', '台账定值', '核对人', '核对日期', '核对结论']
const filterFields = columns.slice(0, 3)
const statuses = ['待核对', '核对中', '核对一致', '核对不符']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const lastMessage = ref('')
const filters = ref<Record<string, string>>({})

const sheetOpen = ref(false)
const sheetRow = ref<EntryRow | null>(null)
const drawerOpen = ref(false)
const drawerRow = ref<EntryRow | null>(null)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() =>
  CONCLUSION_STATS.map((item) => ({
    label: item.label,
    value: rows.value.filter((row) => String(row.status) === item.match).length,
  })),
)

function actionsFor(row: EntryRow): string[] {
  // 待核对可先开始核对；任何状态都能打开核对单（复测）或查看详情。
  return String(row.status) === STATUS_PENDING
    ? ['提交核对', '核对单', '详情']
    : ['核对单', '详情']
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadCheckRows()
}

function openCreate() {
  sheetRow.value = null
  drawerOpen.value = false
  sheetOpen.value = true
}

function openSheet(row: EntryRow | null) {
  sheetRow.value = row
  drawerOpen.value = false
  sheetOpen.value = true
}

function openDetail(row: EntryRow) {
  drawerRow.value = row
  drawerOpen.value = true
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  lastMessage.value = ''
  if (action === '详情') {
    openDetail(row)
    return
  }
  if (action === '核对单') {
    openSheet(row)
    return
  }
  if (action === '提交核对') {
    const result = startCheck(Number(row.id))
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    lastMessage.value = result.message
    reload()
  }
}

function onSubmitted(message: string) {
  sheetOpen.value = false
  lastMessage.value = message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = listCheckRows(filters.value)
    total.value = rows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '定值核对列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.success-text {
  color: #14532d;
}
</style>
