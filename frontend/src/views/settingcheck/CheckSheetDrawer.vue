<template>
  <div class="drawer-mask" @click.self="close">
    <aside class="drawer" role="dialog" aria-modal="true">
      <header class="drawer-head">
        <h3>{{ readonly ? '核对单详情' : (isResubmit ? '复测核对单' : '登记核对单') }}</h3>
        <button class="link" type="button" @click="close">关闭</button>
      </header>

      <!-- 详情/复测入口都展示同一张核对单与同一套核对结论 -->
      <dl v-if="source" class="summary-grid">
        <div><dt>核对编号</dt><dd>{{ source[FIELD_CODE] }}</dd></div>
        <div><dt>所属变电站</dt><dd>{{ source[FIELD_SUBSTATION] || '—' }}</dd></div>
        <div><dt>装置名称</dt><dd>{{ source[FIELD_DEVICE] || '—' }}</dd></div>
        <div><dt>台账定值</dt><dd>{{ ledgerDisplay }}</dd></div>
      </dl>

      <div class="drawer-body">
        <template v-if="!readonly">
          <label v-if="!source" class="form-item">
            <span>核对编号</span>
            <input v-model="form.code" placeholder="同一编号重复提交只留一条" />
          </label>
          <label v-if="!source" class="form-item">
            <span>所属变电站</span>
            <input v-model="form.substation" />
          </label>
          <label v-if="!source" class="form-item">
            <span>装置名称</span>
            <input v-model="form.device" />
          </label>
          <label class="form-item">
            <span>现场定值</span>
            <input v-model="form.siteValue" :placeholder="sitePlaceholder" />
          </label>
          <label class="form-item">
            <span>台账定值</span>
            <input v-model="form.ledgerValue" :placeholder="source ? '留空沿用上次台账定值' : ''" />
          </label>
          <label class="form-item">
            <span>核对人</span>
            <input v-model="form.checker" />
          </label>
          <label class="form-item">
            <span>采集日期</span>
            <input v-model="form.collectedAt" type="date" />
          </label>
        </template>

        <section class="sample-section">
          <h4>采集记录（按采集顺序）</h4>
          <table v-if="samples.length" class="data-table sample-table">
            <thead>
              <tr><th>序次</th><th>现场定值</th><th>台账定值</th><th>核对人</th><th>采集日期</th></tr>
            </thead>
            <tbody>
              <tr v-for="sample in samples" :key="sample.round">
                <td>第 {{ sample.round }} 次</td>
                <td>{{ sample.siteValue }}</td>
                <td>{{ sample.ledgerValue || '—' }}</td>
                <td>{{ sample.checker || '—' }}</td>
                <td>{{ sample.collectedAt || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="empty-state">还没有采集记录</p>
        </section>

        <!-- 核对单与详情抽屉共用的结论块，结论取自同一份判定 -->
        <section
          class="conclusion-box"
          :class="conclusion.text ? (conclusion.match ? 'is-match' : 'is-mismatch') : 'is-pending'"
        >
          <span class="conclusion-label">核对结论</span>
          <strong>{{ conclusion.text || '尚无现场采集，待核对' }}</strong>
        </section>

        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
      </div>

      <footer class="drawer-foot">
        <button class="btn" type="button" @click="close">{{ readonly ? '关闭' : '取消' }}</button>
        <button v-if="!readonly" class="btn primary" type="button" @click="submit">
          {{ isResubmit ? '提交复测' : '提交核对单' }}
        </button>
      </footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import {
  buildConclusionText,
  evaluateCheck,
  FIELD_CHECKER,
  FIELD_CODE,
  FIELD_DATE,
  FIELD_DEVICE,
  FIELD_LEDGER,
  FIELD_SITE,
  FIELD_SUBSTATION,
  submitCheck,
  valuesEqual,
} from '@/domain/settingcheck'
import type { EntryRow } from '@/data/types'

const props = defineProps<{
  /** 传入已有记录：readonly 时是详情抽屉，否则是在该单上复测。 */
  source: EntryRow | null
  readonly: boolean
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'submitted', message: string): void
}>()

const sourceVerdict = computed(() => (props.source ? evaluateCheck(props.source) : null))
const samples = computed(() => sourceVerdict.value?.samples ?? [])

const ledgerDisplay = computed(() => {
  const latest = sourceVerdict.value?.latest
  return latest?.ledgerValue || String(props.source?.[FIELD_LEDGER] ?? '—')
})

const isResubmit = computed(() => props.source !== null)
const sitePlaceholder = computed(() => {
  const latest = sourceVerdict.value?.latest
  return latest ? `复测值，留空沿用 ${latest.siteValue}` : '按现场实际定值填写'
})

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const form = reactive({
  code: '',
  substation: '',
  device: '',
  siteValue: '',
  ledgerValue: '',
  checker: '',
  collectedAt: today(),
})

const errorMessage = ref('')

watch(
  () => props.source,
  (source) => {
    errorMessage.value = ''
    form.siteValue = ''
    form.ledgerValue = ''
    form.collectedAt = today()
    if (source) {
      form.code = String(source[FIELD_CODE] ?? '')
      form.substation = String(source[FIELD_SUBSTATION] ?? '')
      form.device = String(source[FIELD_DEVICE] ?? '')
      form.checker = String(source[FIELD_CHECKER] ?? '')
    }
  },
  { immediate: true },
)

// 编辑态下随录入实时预览统一结论；详情态展示已落库记录的结论。
const conclusion = computed(() => {
  if (props.readonly || !props.source) {
    if (props.source) {
      const verdict = evaluateCheck(props.source)
      return { match: verdict.match, text: verdict.text }
    }
    const site = form.siteValue.trim()
    const ledger = form.ledgerValue.trim()
    if (!site && !ledger) {
      return { match: false, text: '' }
    }
    const match = valuesEqual(site, ledger)
    return { match, text: buildConclusionText(site, ledger, match) }
  }
  const latest = sourceVerdict.value?.samples.length
    ? sourceVerdict.value.samples[sourceVerdict.value.samples.length - 1]
    : null
  const site = form.siteValue.trim() || latest?.siteValue || ''
  const ledger = form.ledgerValue.trim() || latest?.ledgerValue || ''
  const match = valuesEqual(site, ledger)
  return { match, text: buildConclusionText(site, ledger, match) }
})

function close() {
  emit('close')
}

function submit() {
  errorMessage.value = ''
  const latest = sourceVerdict.value?.latest
  const result = submitCheck({
    [FIELD_CODE]: form.code.trim() || String(props.source?.[FIELD_CODE] ?? ''),
    [FIELD_SUBSTATION]: form.substation,
    [FIELD_DEVICE]: form.device,
    [FIELD_SITE]: form.siteValue.trim() || latest?.siteValue || '',
    [FIELD_LEDGER]: form.ledgerValue.trim(),
    [FIELD_CHECKER]: form.checker.trim() || latest?.checker || '',
    [FIELD_DATE]: form.collectedAt,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  emit('submitted', result.message)
}
</script>

<style scoped>
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  justify-content: flex-end;
  z-index: 20;
}
.drawer {
  width: 560px;
  max-width: 92vw;
  background: #fff;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 24px rgba(15, 23, 42, 0.18);
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.drawer-head h3 { margin: 0; font-size: 16px; }
.drawer-body { padding: 14px 18px; overflow: auto; flex: 1; }
.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
  margin: 14px 18px 0;
  padding: 10px 12px;
  background: #f6f8fb;
  border-radius: 8px;
}
.summary-grid dt { font-size: 12px; color: var(--muted); }
.summary-grid dd { margin: 2px 0 0; font-size: 13px; }
.form-item { display: block; margin-bottom: 10px; }
.form-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.form-item input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.sample-section { margin-top: 8px; }
.sample-section h4 { font-size: 13px; margin: 0 0 6px; }
.sample-table th, .sample-table td { font-size: 12px; padding: 6px 8px; }
.conclusion-box {
  margin-top: 14px;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.conclusion-box.is-match { background: #ecfdf3; border: 1px solid #75e0a7; }
.conclusion-box.is-mismatch { background: #fef3f2; border: 1px solid #f5a39a; }
.conclusion-box.is-pending { background: #f6f8fb; border: 1px solid var(--border); }
.conclusion-label { font-size: 12px; color: var(--muted); }
.drawer-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}
</style>
