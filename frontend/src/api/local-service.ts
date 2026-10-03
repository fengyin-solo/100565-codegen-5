import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
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

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// —— 用热报装与入网验收（heatapply）专属规则 ——
// 这一模块不只是改状态：受理要核材料、面积超核定要转人工复核、验收要卡合同与面积口径、
// 跨月补交要单独归摞、验收通过要驱动入户服务待回访清单。规则都收在这一节，页面只渲染。

const HEATAPPLY_KEY = 'heatapply'
const HOUSEHOLD_KEY = 'householdservice'

/** 固定次序：受理 → 勘测 → 验收 → 并网，跳级一律挡回。 */
const HEATAPPLY_FLOW_ACTIONS: Record<string, string> = {
  受理申请: '已受理',
  登记勘测: '已勘测',
  组织验收: '已验收',
  办理并网: '已并网',
}

/** 每个流转动作允许的起点状态。 */
const HEATAPPLY_FLOW_FROM: Record<string, string[]> = {
  受理申请: ['待受理', '人工复核'],
  登记勘测: ['已受理'],
  组织验收: ['已勘测'],
  办理并网: ['已验收'],
}

/** 各小区核定供热面积（㎡）：受理时把已受理及以后环节的面积累计进来比对。 */
const COMMUNITY_AREA_QUOTA: Record<string, number> = {
  锦绣家园: 500,
  滨河新区: 400,
  朝阳里: 300,
}

/** 交费凭证取值：缺失不收、超范围一律挡回。 */
export const HEATAPPLY_VOUCHER_OPTIONS = ['已附', '缺失', '超范围']
const VOUCHER_MISSING = '缺失'
const VOUCHER_OUT_OF_RANGE = '超范围'
const CONTRACT_SIGNED = '已签妥'

export type HeatapplyDraft = {
  申请人: string
  所属小区: string
  用热面积: number
  交费凭证: string
  申请日期: string
  补交日期?: string
}

export type HeatapplyPage = {
  items: EntryRow[]
  supplements: EntryRow[]
  total: number
}

function heatapplyRows(): EntryRow[] {
  return listRows(HEATAPPLY_KEY)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function writeHeatapplyRow(rows: EntryRow[], updated: EntryRow): void {
  saveRows(HEATAPPLY_KEY, rows.map((row) => (Number(row.id) === Number(updated.id) ? updated : row)))
}

function monthOf(value: unknown): string {
  return String(value ?? '').slice(0, 7)
}

/** 跨月补交：补交日期与申请日期不在同一个月的单子，单独放一摞。 */
export function isCrossMonthSupplement(row: EntryRow): boolean {
  const applied = monthOf(row['申请日期'])
  const supplemented = monthOf(row['补交日期'])
  return applied !== '' && supplemented !== '' && applied !== supplemented
}

/** 主摞与跨月补交摞分开返回，页面各摆一张表。 */
export function listHeatapplyEntries(filters: Record<string, string> = {}): HeatapplyPage {
  const matched = filterRows(heatapplyRows(), filters)
  return {
    items: matched.filter((row) => !isCrossMonthSupplement(row)),
    supplements: matched.filter((row) => isCrossMonthSupplement(row)),
    total: matched.length,
  }
}

export function heatapplyCommunities(): string[] {
  return Object.keys(COMMUNITY_AREA_QUOTA)
}

/** 登记报装申请：重复提交（同申请人、同小区、同面积）只算一次。 */
export function createHeatapplyEntry(draft: HeatapplyDraft): ActionResult {
  if (!draft.申请人.trim()) {
    return { ok: false, message: '申请人不能为空' }
  }
  if (!(Number(draft.用热面积) > 0)) {
    return { ok: false, message: '用热面积必须大于 0' }
  }
  if (!COMMUNITY_AREA_QUOTA[draft.所属小区]) {
    return { ok: false, message: `小区「${draft.所属小区}」不在核定范围内` }
  }
  const rows = heatapplyRows()
  const duplicated = rows.find(
    (row) =>
      String(row['申请人']) === draft.申请人.trim() &&
      String(row['所属小区']) === draft.所属小区 &&
      Number(row['用热面积']) === Number(draft.用热面积),
  )
  if (duplicated) {
    return { ok: true, message: `该户报装申请已登记过（${duplicated['报装编号']}），重复提交只算一次` }
  }
  const seq = nextId(rows)
  const year = (draft.申请日期 || '').slice(0, 4) || '2026'
  const entry: EntryRow = {
    id: seq,
    status: '待受理',
    pending: true,
    abnormal: false,
    报装编号: `BA-${year}-${String(seq).padStart(4, '0')}`,
    申请人: draft.申请人.trim(),
    所属小区: draft.所属小区,
    用热面积: Number(draft.用热面积),
    交费凭证: draft.交费凭证,
    供热合同: '未签',
    验收面积: '',
    申请日期: draft.申请日期,
    补交日期: draft.补交日期 ?? '',
  }
  saveRows(HEATAPPLY_KEY, [...rows, entry])
  return { ok: true, message: `报装申请 ${entry['报装编号']} 已登记，等待受理` }
}

/** 已受理及以后环节占用的面积，用来和小区核定范围比对。 */
function acceptedArea(rows: EntryRow[], community: string, exceptId: number): number {
  const counted = ['已受理', '已勘测', '已验收', '已并网']
  return rows
    .filter(
      (row) =>
        String(row['所属小区']) === community &&
        counted.includes(String(row.status)) &&
        Number(row.id) !== exceptId,
    )
    .reduce((sum, row) => sum + (Number(row['用热面积']) || 0), 0)
}

/** 受理：按材料齐备判定。缺交费凭证的不收，凭证超范围的一律挡回，面积超核定的转人工复核。 */
function acceptHeatapplyEntry(row: EntryRow, rows: EntryRow[]): ActionResult {
  // 受理沿用既有判定：人工复核通过的单子不再重复核材料，直接转已受理。
  if (String(row.status) === '人工复核') {
    writeHeatapplyRow(rows, { ...row, status: '已受理', pending: true, abnormal: false })
    return { ok: true, message: '人工复核已通过，受理沿用既有判定，转入「已受理」' }
  }
  const voucher = String(row['交费凭证'])
  if (voucher === VOUCHER_MISSING) {
    writeHeatapplyRow(rows, { ...row, status: '已退回', pending: false, abnormal: true })
    return { ok: false, message: '报装申请缺交费凭证，不予受理，已退回' }
  }
  if (voucher === VOUCHER_OUT_OF_RANGE) {
    writeHeatapplyRow(rows, { ...row, status: '已退回', pending: false, abnormal: true })
    return { ok: false, message: '交费凭证超出范围，一律挡回，已退回' }
  }
  const community = String(row['所属小区'])
  const quota = COMMUNITY_AREA_QUOTA[community]
  const taken = acceptedArea(rows, community, Number(row.id))
  if (quota !== undefined && taken + Number(row['用热面积']) > quota) {
    writeHeatapplyRow(rows, { ...row, status: '人工复核', pending: true, abnormal: false })
    return { ok: true, message: `用热面积累计超出${community}核定范围（${quota}㎡），已转人工复核` }
  }
  writeHeatapplyRow(rows, { ...row, status: '已受理', pending: true, abnormal: false })
  return { ok: true, message: '材料齐备，报装申请已受理' }
}

/** 验收通过后生成入户服务待回访单（已处理、待回访），驱动入户服务的待回访清单。 */
function createFollowupVisit(entry: EntryRow): void {
  const rows = listRows(HOUSEHOLD_KEY)
  const seq = nextId(rows)
  const visit: EntryRow = {
    id: seq,
    status: '已处理',
    pending: true,
    abnormal: false,
    服务单号: `HOUS-${String(seq).padStart(4, '0')}`,
    报修用户: entry['申请人'],
    服务内容: `入网验收通过（${entry['报装编号']}），安排入户回访`,
    受理人: '验收组',
    上门时间: '',
    处理结果: '入网验收通过，待入户回访',
    回访日期: '',
    服务状态: '已处理',
  }
  saveRows(HOUSEHOLD_KEY, [...rows, visit])
}

export function runHeatapplyAction(id: number, action: string): ActionResult {
  const rows = heatapplyRows()
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的报装申请单` }
  }
  const current = String(row.status)

  // 登记合同：只补合同状态，不动环节；验收前必须签妥。
  if (action === '登记合同') {
    if (current === '已并网' || current === '已退回') {
      return { ok: false, message: `当前「${current}」，无需再登记供热合同` }
    }
    if (String(row['供热合同']) === CONTRACT_SIGNED) {
      return { ok: false, message: '供热合同已签妥，不用重复登记' }
    }
    writeHeatapplyRow(rows, { ...row, 供热合同: CONTRACT_SIGNED })
    return { ok: true, message: '供热合同已签妥，可以排入网验收' }
  }

  if (action === '退回申请') {
    if (current !== '待受理' && current !== '人工复核') {
      return { ok: false, message: `只有待受理或人工复核中的申请单能退回，当前「${current}」` }
    }
    writeHeatapplyRow(rows, { ...row, status: '已退回', pending: false, abnormal: true })
    return { ok: true, message: '报装申请单已退回' }
  }

  const target = HEATAPPLY_FLOW_ACTIONS[action]
  if (!target) {
    return { ok: false, message: `报装申请单没有登记「${action}」这个动作` }
  }
  // 只能按受理、勘测、验收、并网的次序推进，跳级的挡回。
  if (!HEATAPPLY_FLOW_FROM[action].includes(current)) {
    return { ok: false, message: `只能按受理、勘测、验收、并网的次序推进，当前「${current}」不能${action}，已挡回` }
  }

  if (action === '受理申请') {
    return acceptHeatapplyEntry(row, rows)
  }

  if (action === '组织验收') {
    // 入网验收必须等供热合同签妥再排。
    if (String(row['供热合同']) !== CONTRACT_SIGNED) {
      return { ok: false, message: '入网验收必须等供热合同签妥再排，请先登记合同' }
    }
    // 申请表与验收表的用热面积要用同一套数：验收表未填的沿用申请表，填了不一致的挡回。
    const applied = Number(row['用热面积'])
    const surveyed = String(row['验收面积'] ?? '').trim()
    if (surveyed !== '' && Number(surveyed) !== applied) {
      return { ok: false, message: `验收表用热面积（${surveyed}㎡）与申请表（${applied}㎡）不一致，须用同一套数，已挡回` }
    }
    const updated: EntryRow = { ...row, status: '已验收', 验收面积: applied, pending: true, abnormal: false }
    writeHeatapplyRow(rows, updated)
    createFollowupVisit(updated)
    return { ok: true, message: '入网验收通过，已生成入户服务待回访单' }
  }

  writeHeatapplyRow(rows, { ...row, status: target, pending: target !== '已并网', abnormal: false })
  return { ok: true, message: `报装申请单已${action}，当前状态「${target}」` }
}
