<template>
  <div v-if="outcome" class="conclusion-panel" :class="badgeClass">
    <div class="conclusion-head">
      <span class="conclusion-label">核对结论</span>
      <span class="conclusion-badge">{{ outcome.status }}</span>
    </div>
    <p class="conclusion-text">{{ outcome.conclusion }}</p>
    <dl class="conclusion-meta">
      <div>
        <dt>现场定值</dt>
        <dd>{{ outcome.siteValue || '—' }}</dd>
      </div>
      <div>
        <dt>台账定值</dt>
        <dd>{{ outcome.ledgerValue || '—' }}</dd>
      </div>
      <div>
        <dt>判定依据</dt>
        <dd>第 {{ outcome.round || '—' }} 次采集{{ outcome.round > 1 ? '（复测取最后一次）' : '' }}</dd>
      </div>
    </dl>
    <ul v-if="collections.length" class="collection-track">
      <li v-for="item in collections" :key="item.round">
        <span class="track-round">第{{ item.round }}次{{ item.retest ? '复测' : '初测' }}</span>
        <span class="track-values">现场 {{ item.siteValue || '—' }} / 台账 {{ item.ledgerValue || '—' }}</span>
        <span class="track-meta">{{ item.checker || '未填写核对人' }} · {{ item.date || '未填写日期' }}</span>
      </li>
    </ul>
  </div>
  <p v-else class="conclusion-empty">暂无核对结论，提交核对单后按现场定值统一判定。</p>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import {
  asCollections,
  deriveCheckOutcome,
  STATUS_MATCH,
  STATUS_MISMATCH,
  STATUS_PENDING,
} from '@/domain/setting-check'
import type { EntryRow } from '@/data/types'

// 核对单与详情抽屉两处的核对结论共用本组件，结论只来自共用判定，不接收外部传入的结论文案。
const props = defineProps<{ row: EntryRow | null }>()

const outcome = computed(() => (props.row ? deriveCheckOutcome(props.row) : null))
const collections = computed(() => (props.row ? asCollections(props.row) : []))

const badgeClass = computed(() => {
  if (!outcome.value) {
    return ''
  }
  if (outcome.value.status === STATUS_MATCH) {
    return 'is-match'
  }
  if (outcome.value.status === STATUS_MISMATCH) {
    return 'is-mismatch'
  }
  return outcome.value.status === STATUS_PENDING ? 'is-pending' : 'is-checking'
})
</script>

<style scoped>
.conclusion-panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  background: #f8fafc;
}
.conclusion-panel.is-match {
  border-color: #b7e4c7;
  background: #f1faf4;
}
.conclusion-panel.is-mismatch {
  border-color: #f3c0b8;
  background: #fef3f1;
}
.conclusion-panel.is-pending {
  border-color: var(--border);
}
.conclusion-panel.is-checking {
  border-color: #c7d7f3;
  background: #f3f7fe;
}
.conclusion-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.conclusion-label {
  font-size: 13px;
  color: var(--muted);
}
.conclusion-badge {
  font-size: 12px;
  border-radius: 999px;
  padding: 2px 10px;
  background: #e2e8f0;
}
.is-match .conclusion-badge {
  background: #d3f0dd;
  color: #14532d;
}
.is-mismatch .conclusion-badge {
  background: #f8d7d1;
  color: #7a271a;
}
.conclusion-text {
  margin: 8px 0 0;
  font-size: 14px;
}
.conclusion-meta {
  display: flex;
  gap: 24px;
  margin: 10px 0 0;
  font-size: 12px;
}
.conclusion-meta dt {
  color: var(--muted);
}
.conclusion-meta dd {
  margin: 2px 0 0;
  font-size: 13px;
}
.collection-track {
  list-style: none;
  margin: 10px 0 0;
  padding: 10px 0 0;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.collection-track li {
  display: flex;
  gap: 10px;
  font-size: 12px;
  align-items: baseline;
}
.track-round {
  min-width: 64px;
  color: var(--brand);
}
.track-values {
  flex: 1;
}
.track-meta {
  color: var(--muted);
}
.conclusion-empty {
  color: var(--muted);
  font-size: 13px;
}
</style>
