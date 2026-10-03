<template>
  <section class="page" data-module="heatconnection">
    <header class="page-head">
      <div>
        <h2>居民用热报装与入网验收台账</h2>
        <p class="page-desc">一张单从窗口受理走到勘测、合同、验收、并网；受理沿用材料齐备与面积判定，跨月补交单独成摞。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showForm = !showForm">
          {{ showForm ? '收起报装登记' : '登记报装申请' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出台账</button>
      </div>
    </header>

    <form v-if="showForm" class="entry-panel" @submit.prevent="submitApplication">
      <h3>窗口受理报装申请</h3>
      <div class="form-grid">
        <label v-for="field in createFields" :key="field.name" class="filter-item">
          <span>{{ field.label }}<em v-if="field.required">*</em></span>
          <input
            v-model="form[field.name]"
            :type="field.type"
            :placeholder="field.placeholder"
          />
        </label>
      </div>
      <p class="rule-text">
        缺交费凭证不收；申请表面积超出小区核定上限转人工复核；交费凭证面积超出核定范围一律挡回；同小区、同门牌、同申请人重复提交只算一次。
      </p>
      <div class="form-actions">
        <button class="btn primary" type="submit">提交受理判定</button>
        <button class="btn ghost" type="button" @click="resetForm">清空</button>
      </div>
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
      <label class="filter-item">
        <span>当前状态</span>
        <select v-model="statusFilter">
          <option value="">全部状态</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <section class="pile-section">
      <h3>正常受理台账</h3>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in tableColumns" :key="column">{{ column }}</th>
              <th>当前状态</th>
              <th>流程进度</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in normalRows" :key="String(row.id)">
              <tr>
                <td v-for="column in tableColumns" :key="column">{{ formatCell(row, column) }}</td>
                <td><span :class="['status-pill', row.abnormal ? 'bad' : '']">{{ row.status }}</span></td>
                <td class="stage-line">{{ stageLine(row) }}</td>
                <td class="row-actions">
                  <button
                    v-for="action in availableActions(row)"
                    :key="action"
                    class="link"
                    type="button"
                    @click="runAction(action, row)"
                  >
                    {{ action }}
                  </button>
                </td>
              </tr>
              <tr class="detail-row">
                <td :colspan="tableColumns.length + 3">
                  <div class="detail-grid">
                    <span v-for="field in detailFields" :key="field">
                      <b>{{ field }}：</b>{{ formatCell(row, field) }}
                    </span>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="!normalRows.length">
              <td :colspan="tableColumns.length + 3" class="empty-state">暂无符合条件的正常受理记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="pile-section overdue">
      <h3>跨月补交单独一摞</h3>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in tableColumns" :key="column">{{ column }}</th>
              <th>当前状态</th>
              <th>流程进度</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in overdueRows" :key="String(row.id)">
              <tr>
                <td v-for="column in tableColumns" :key="column">{{ formatCell(row, column) }}</td>
                <td><span :class="['status-pill', row.abnormal ? 'bad' : '']">{{ row.status }}</span></td>
                <td class="stage-line">{{ stageLine(row) }}</td>
                <td class="row-actions">
                  <button
                    v-for="action in availableActions(row)"
                    :key="action"
                    class="link"
                    type="button"
                    @click="runAction(action, row)"
                  >
                    {{ action }}
                  </button>
                </td>
              </tr>
              <tr class="detail-row">
                <td :colspan="tableColumns.length + 3">
                  <div class="detail-grid">
                    <span v-for="field in detailFields" :key="field">
                      <b>{{ field }}：</b>{{ formatCell(row, field) }}
                    </span>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="!overdueRows.length">
              <td :colspan="tableColumns.length + 3" class="empty-state">暂无跨月补交记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <footer class="page-foot">
      <span>共 {{ filteredRows.length }} 条筛选结果；正常 {{ normalRows.length }} 条，跨月补交 {{ overdueRows.length }} 条</span>
      <span v-if="message" :class="messageOk ? 'success-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createHeatConnection,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  type HeatConnectionInput,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('heatconnection')
const statuses = ['人工复核', '已受理', '已勘测', '待验收', '验收不合格', '待并网', '已并网', '复核驳回']
const tableColumns = ['报装编号', '小区名称', '楼栋门牌', '申请人', '经办人', '申请日期', '缴费日期', '资料分摞', '申请表用热面积', '凭证编号', '凭证面积', '合同状态', '验收编号', '验收结果']
const detailFields = ['联系电话', '核定面积上限', '受理日期', '受理判定', '勘测日期', '勘测结论', '合同编号', '签订日期', '验收表用热面积', '计划验收日期', '验收日期', '并网日期', '复核日期', '复核结论']
const filterFields = ['报装编号', '小区名称', '楼栋门牌', '申请人', '经办人', '凭证编号', '合同编号', '验收编号']
const createFields: { name: keyof HeatConnectionInput; label: string; required: boolean; type: string; placeholder: string }[] = [
  { name: '小区名称', label: '小区名称', required: true, type: 'text', placeholder: '如：滨河新居' },
  { name: '楼栋门牌', label: '楼栋门牌', required: true, type: 'text', placeholder: '如：3-1-402' },
  { name: '申请人', label: '申请人', required: true, type: 'text', placeholder: '居民姓名' },
  { name: '联系电话', label: '联系电话', required: false, type: 'tel', placeholder: '可选' },
  { name: '经办人', label: '窗口经办人', required: true, type: 'text', placeholder: '经办人姓名' },
  { name: '申请日期', label: '申请日期', required: true, type: 'date', placeholder: '' },
  { name: '缴费日期', label: '缴费凭证日期', required: true, type: 'date', placeholder: '' },
  { name: '申请表用热面积', label: '申请表用热面积(㎡)', required: true, type: 'number', placeholder: '申请表面积' },
  { name: '核定面积上限', label: '小区核定面积上限(㎡)', required: true, type: 'number', placeholder: '核定范围' },
  { name: '凭证编号', label: '交费凭证编号', required: true, type: 'text', placeholder: '凭证编号' },
  { name: '凭证面积', label: '凭证载明面积(㎡)', required: true, type: 'number', placeholder: '凭证面积' },
]

const rows = ref<EntryRow[]>([])
const filters = ref<Record<string, string>>({})
const statusFilter = ref('')
const showForm = ref(false)
const message = ref('')
const messageOk = ref(true)

const emptyForm = (): HeatConnectionInput => ({
  报装编号: '',
  小区名称: '',
  楼栋门牌: '',
  申请人: '',
  联系电话: '',
  经办人: '',
  申请日期: '',
  缴费日期: '',
  申请表用热面积: '',
  核定面积上限: '',
  凭证编号: '',
  凭证面积: '',
})
const form = reactive<HeatConnectionInput>(emptyForm())

const filteredRows = computed(() => {
  const payload = listEntries(meta.key, filters.value).items
  if (!statusFilter.value) return payload
  return payload.filter((row) => String(row.status) === statusFilter.value)
})
const normalRows = computed(() => filteredRows.value.filter((row) => row.资料分摞 !== '跨月补交'))
const overdueRows = computed(() => filteredRows.value.filter((row) => row.资料分摞 === '跨月补交'))

const stats = computed(() => [
  { label: '人工复核单数', value: rows.value.filter((row) => row.status === '人工复核').length },
  { label: '待勘测单数', value: rows.value.filter((row) => row.status === '已受理').length },
  { label: '验收中单量', value: rows.value.filter((row) => ['已勘测', '待验收', '验收不合格'].includes(String(row.status))).length },
  { label: '待并网单数', value: rows.value.filter((row) => row.status === '待并网').length },
  { label: '跨月补交单数', value: rows.value.filter((row) => row.资料分摞 === '跨月补交').length },
  { label: '已并网单数', value: rows.value.filter((row) => row.status === '已并网').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function availableActions(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '人工复核':
      return ['复核通过', '驳回申请']
    case '已受理':
      return ['完成勘测']
    case '已勘测':
      return row.合同状态 === '已签订' ? ['排期验收'] : ['签订合同']
    case '待验收':
      return ['验收合格', '验收不合格']
    case '验收不合格':
      return ['整改复验']
    case '待并网':
      return ['办理并网']
    default:
      return []
  }
}

function stageLine(row: EntryRow): string {
  const stages = ['受理', '勘测', '验收', '并网']
  const rank: Record<string, number> = {
    人工复核: 0,
    复核驳回: 0,
    已受理: 1,
    已勘测: 2,
    待验收: 3,
    验收不合格: 3,
    待并网: 3,
    已并网: 4,
  }
  const done = rank[String(row.status)] ?? 0
  return stages.map((stage, index) => `${index < done ? '✓' : index === done ? '●' : '○'}${stage}`).join(' → ')
}

function formatCell(row: EntryRow, field: string): string {
  const value = row[field]
  if (value === undefined || value === '') return '—'
  return String(value)
}

function setNotice(result: { ok: boolean; message: string }) {
  messageOk.value = result.ok
  message.value = result.message
}

function submitApplication() {
  const result = createHeatConnection({ ...form })
  setNotice(result)
  if (result.ok) {
    resetForm()
    showForm.value = false
    reload()
  }
}

function resetForm() {
  Object.assign(form, emptyForm())
}

function runAction(action: string, row: EntryRow) {
  setNotice(applyAction(meta.key, Number(row.id), action))
  reload()
}

function resetFilters() {
  filters.value = {}
  statusFilter.value = ''
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  message.value = ''
  rows.value = listEntries(meta.key).items
}

onMounted(reload)
</script>
