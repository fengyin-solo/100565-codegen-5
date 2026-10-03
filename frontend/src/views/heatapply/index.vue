<template>
  <section class="page" data-module="heatapply">
    <header class="page-head">
      <div>
        <h2>居民用热报装与入网验收台账</h2>
        <p class="page-desc">一张单从受理、勘测、验收到并网顺序推进；受理按材料齐备判定，验收前须签妥供热合同，验收结果驱动入户服务待回访清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showCreate = !showCreate">登记报装申请</button>
        <button class="btn" type="button" @click="exportRows">导出报装验收清单</button>
      </div>
    </header>

    <form v-if="showCreate" class="filter-bar create-bar" @submit.prevent="submitCreate">
      <label class="filter-item">
        <span>申请人</span>
        <input v-model="draft.申请人" placeholder="户主姓名" />
      </label>
      <label class="filter-item">
        <span>所属小区</span>
        <select v-model="draft.所属小区">
          <option v-for="item in communities" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>用热面积（㎡）</span>
        <input v-model.number="draft.用热面积" type="number" min="1" placeholder="按申请表填写" />
      </label>
      <label class="filter-item">
        <span>交费凭证</span>
        <select v-model="draft.交费凭证">
          <option v-for="item in voucherOptions" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>申请日期</span>
        <input v-model="draft.申请日期" type="date" />
      </label>
      <label class="filter-item">
        <span>补交日期（可空）</span>
        <input v-model="draft.补交日期" type="date" />
      </label>
      <button class="btn primary" type="submit">提交申请</button>
    </form>

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
          <td v-for="column in columns" :key="column">{{ row[column] === '' ? '—' : (row[column] ?? '—') }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无报装申请数据，可先登记报装申请</td>
        </tr>
      </tbody>
    </table>

    <h3 class="pile-title">跨月补交（单独一摞）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in supplements" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] === '' ? '—' : (row[column] ?? '—') }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!supplements.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无跨月补交的报装申请</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条报装申请记录，其中跨月补交 {{ supplements.length }} 条</span>
      <span v-if="feedback" :class="feedbackOk ? 'notice-text' : 'error-text'">{{ feedback }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  HEATAPPLY_VOUCHER_OPTIONS,
  createHeatapplyEntry,
  downloadEntries,
  heatapplyCommunities,
  listHeatapplyEntries,
  moduleMeta,
  runHeatapplyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('heatapply')
const columns = ["报装编号", "申请人", "所属小区", "用热面积", "交费凭证", "供热合同", "验收面积", "申请日期", "补交日期"]
const actions = ["受理申请", "登记勘测", "组织验收", "办理并网", "登记合同", "退回申请"]
const statuses = ["待受理", "已受理", "已勘测", "已验收", "已并网", "人工复核", "已退回"]
const statLabels = ["待受理申请", "人工复核中", "已并网户数"]
const statStatus: Record<string, string> = { 待受理申请: "待受理", 人工复核中: "人工复核", 已并网户数: "已并网" }

const rows = ref<EntryRow[]>([])
const supplements = ref<EntryRow[]>([])
const allRowsSnapshot = ref<EntryRow[]>([])
const total = ref(0)
const feedback = ref('')
const feedbackOk = ref(true)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showCreate = ref(false)
const communities = heatapplyCommunities()
const voucherOptions = HEATAPPLY_VOUCHER_OPTIONS

const today = new Date().toISOString().slice(0, 10)
const emptyDraft = () => ({
  申请人: '',
  所属小区: communities[0] ?? '',
  用热面积: 0,
  交费凭证: voucherOptions[0] ?? '已附',
  申请日期: today,
  补交日期: '',
})
const draft = ref(emptyDraft())

const stats = computed(() =>
  statLabels.map((label) => ({
    label,
    value: allRowsSnapshot.value.filter((row) => String(row.status) === statStatus[label]).length,
  })),
)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: allRowsSnapshot.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function submitCreate() {
  const result = createHeatapplyEntry({ ...draft.value })
  feedback.value = result.message
  feedbackOk.value = result.ok
  if (result.ok) {
    draft.value = emptyDraft()
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  const result = runHeatapplyAction(Number(row.id), action)
  feedback.value = result.message
  feedbackOk.value = result.ok
  reload()
}

function reload() {
  try {
    const payload = listHeatapplyEntries(filters.value)
    rows.value = payload.items
    supplements.value = payload.supplements
    total.value = payload.total
    const all = listHeatapplyEntries()
    allRowsSnapshot.value = [...all.items, ...all.supplements]
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : '报装申请列表读取失败'
    feedbackOk.value = false
  }
}

onMounted(reload)
</script>

<style scoped>
.create-bar {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}
.pile-title {
  font-size: 14px;
  margin: 16px 0 8px;
}
.notice-text {
  color: #067647;
}
</style>
