<template>
  <div v-if="open" class="drawer-mask" @click.self="close">
    <aside class="drawer-panel" role="dialog" aria-modal="true" aria-label="核对记录详情">
      <header class="drawer-head">
        <h3>核对记录详情</h3>
        <button class="link" type="button" @click="close">关闭</button>
      </header>

      <template v-if="row">
        <dl class="detail-grid">
          <div v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ row[field] ?? '—' }}</dd>
          </div>
          <div>
            <dt>当前状态</dt>
            <dd>{{ row.status }}</dd>
          </div>
        </dl>

        <!-- 详情抽屉与核对单的核对结论共用同一组件、同一判定 -->
        <CheckConclusionPanel :row="row" />

        <footer class="drawer-foot">
          <button class="btn" type="button" @click="retest">复测 / 编辑核对单</button>
        </footer>
      </template>
    </aside>
  </div>
</template>

<script setup lang="ts">
import CheckConclusionPanel from './CheckConclusionPanel.vue'
import { FIELD_CHECKER, FIELD_DATE, FIELD_DEVICE, FIELD_LEDGER, FIELD_NO, FIELD_RESULT, FIELD_SITE, FIELD_STATION } from '@/domain/setting-check'
import type { EntryRow } from '@/data/types'

// 详情抽屉展示的核对结论与核对单提交页完全共用 CheckConclusionPanel。
defineProps<{ open: boolean; row: EntryRow | null }>()
const emit = defineEmits<{ close: []; retest: [] }>()

const detailFields = [
  FIELD_NO,
  FIELD_STATION,
  FIELD_DEVICE,
  FIELD_SITE,
  FIELD_LEDGER,
  FIELD_CHECKER,
  FIELD_DATE,
  FIELD_RESULT,
]

function close() {
  emit('close')
}

function retest() {
  emit('retest')
}
</script>

<style scoped>
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  justify-content: flex-end;
  z-index: 40;
}
.drawer-panel {
  width: min(460px, 100%);
  height: 100%;
  background: #fff;
  padding: 16px 18px;
  overflow-y: auto;
  box-shadow: -8px 0 24px rgba(15, 23, 42, 0.12);
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.drawer-head h3 {
  margin: 0;
  font-size: 16px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
  margin: 0 0 14px;
}
.detail-grid dt {
  font-size: 12px;
  color: var(--muted);
}
.detail-grid dd {
  margin: 2px 0 0;
  font-size: 13px;
  word-break: break-all;
}
.drawer-foot {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}
</style>
