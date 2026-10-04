<template>
  <div v-if="open" class="sheet-mask" @click.self="close">
    <div class="sheet-dialog" role="dialog" aria-modal="true" aria-label="定值核对单">
      <header class="sheet-head">
        <h3>定值核对单</h3>
        <button class="link" type="button" @click="close">关闭</button>
      </header>

      <form class="sheet-form" @submit.prevent="submit">
        <label class="sheet-item">
          <span>核对编号</span>
          <input v-model="form.checkNo" :disabled="isExisting" placeholder="如 SETT-0007" required />
        </label>
        <label class="sheet-item">
          <span>所属变电站</span>
          <input v-model="form.station" placeholder="如 110kV云溪变电站" />
        </label>
        <label class="sheet-item">
          <span>装置名称</span>
          <input v-model="form.device" placeholder="如 1号主变差动保护" required />
        </label>
        <label class="sheet-item">
          <span>现场定值</span>
          <input v-model="form.siteValue" placeholder="本次现场采集值，复测填写最新值" />
        </label>
        <label class="sheet-item">
          <span>台账定值</span>
          <input v-model="form.ledgerValue" placeholder="台账登记整定值" />
        </label>
        <label class="sheet-item">
          <span>核对人</span>
          <input v-model="form.checker" :placeholder="`默认 ${operator}`" />
        </label>
        <label class="sheet-item">
          <span>核对日期</span>
          <input v-model="form.date" type="date" />
        </label>
        <label v-if="isExisting" class="sheet-retest">
          <input v-model="form.retest" type="checkbox" />
          <span>本次为复测，数值未变也要留一条采集记录（结论以采集顺序的最后一次为准）</span>
        </label>

        <!-- 核对单里的结论预览与落库结论走同一套共用判定 -->
        <CheckConclusionPanel :row="previewRow" />

        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
        <footer class="sheet-foot">
          <button class="btn ghost" type="button" @click="close">取消</button>
          <button class="btn primary" type="submit">{{ isExisting ? '提交核对（同一核对单只留一条）' : '登记并提交核对' }}</button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import CheckConclusionPanel from './CheckConclusionPanel.vue'
import { submitCheckSheet, type CheckSheetForm } from '@/api/setting-check-service'
import {
  FIELD_CHECKER,
  FIELD_DATE,
  FIELD_DEVICE,
  FIELD_LEDGER,
  FIELD_NO,
  FIELD_SITE,
  FIELD_STATION,
  applyOutcome,
  asCollections,
  type CheckCollection,
} from '@/domain/setting-check'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const props = defineProps<{ open: boolean; row: EntryRow | null }>()
const emit = defineEmits<{ close: []; submitted: [message: string] }>()

const store = useSessionStore()
const operator = computed(() => store.operator)

function emptyForm(): CheckSheetForm {
  return {
    checkNo: '',
    station: '',
    device: '',
    siteValue: '',
    ledgerValue: '',
    checker: store.operator,
    date: new Date().toISOString().slice(0, 10),
    retest: false,
  }
}

const form = reactive<CheckSheetForm>(emptyForm())
const errorMessage = ref('')
const existingCollections = ref<CheckCollection[]>([])

const isExisting = computed(() => props.row !== null)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      return
    }
    errorMessage.value = ''
    Object.assign(form, emptyForm())
    if (props.row) {
      form.checkNo = String(props.row[FIELD_NO] ?? '')
      form.station = String(props.row[FIELD_STATION] ?? '')
      form.device = String(props.row[FIELD_DEVICE] ?? '')
      form.siteValue = String(props.row[FIELD_SITE] ?? '')
      form.ledgerValue = String(props.row[FIELD_LEDGER] ?? '')
      form.checker = String(props.row[FIELD_CHECKER] ?? '') || store.operator
      form.date = String(props.row[FIELD_DATE] ?? '') || form.date
      existingCollections.value = asCollections(props.row)
    } else {
      existingCollections.value = []
    }
  },
)

// 预览行：把表单当作一条待提交采集记录拼进采集序列，结论仍由共用判定计算。
const previewRow = computed<EntryRow | null>(() => {
  if (!props.open) {
    return null
  }
  const collections = existingCollections.value.map((item) => ({ ...item }))
  const last = collections.at(-1)
  const changed =
    last === undefined ||
    last.siteValue !== form.siteValue.trim() ||
    last.ledgerValue !== form.ledgerValue.trim() ||
    last.checker !== form.checker.trim() ||
    last.date !== form.date ||
    form.retest
  if (form.siteValue.trim() && changed) {
    collections.push({
      round: (last?.round ?? 0) + 1,
      siteValue: form.siteValue.trim(),
      ledgerValue: form.ledgerValue.trim(),
      checker: form.checker.trim(),
      date: form.date,
      retest: last !== undefined || form.retest,
    })
  }
  const draft: EntryRow = {
    id: props.row?.id ?? 0,
    status: props.row?.status ?? '待核对',
    pending: true,
    abnormal: false,
    [FIELD_NO]: form.checkNo,
    [FIELD_STATION]: form.station,
    [FIELD_DEVICE]: form.device,
    [FIELD_SITE]: form.siteValue,
    [FIELD_LEDGER]: form.ledgerValue,
    [FIELD_CHECKER]: form.checker,
    [FIELD_DATE]: form.date,
    采集记录: collections,
  }
  return applyOutcome(draft)
})

function close() {
  emit('close')
}

function submit() {
  errorMessage.value = ''
  if (!form.checker.trim()) {
    form.checker = store.operator
  }
  const result = submitCheckSheet({ ...form })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  emit('submitted', result.message)
}
</script>

<style scoped>
.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 16px;
  z-index: 40;
  overflow-y: auto;
}
.sheet-dialog {
  width: min(640px, 100%);
  background: #fff;
  border-radius: 10px;
  padding: 16px 18px;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.2);
}
.sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.sheet-head h3 {
  margin: 0;
  font-size: 16px;
}
.sheet-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sheet-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.sheet-item input {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
}
.sheet-item input:disabled {
  background: #f1f5f9;
  color: var(--muted);
}
.sheet-retest {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
}
.sheet-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
