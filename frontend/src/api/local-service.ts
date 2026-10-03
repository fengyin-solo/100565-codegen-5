import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']
const HEAT_CONNECTION_KEY = 'heatconnection'
const HOUSEHOLD_SERVICE_KEY = 'householdservice'

export type HeatConnectionInput = {
  报装编号: string
  小区名称: string
  楼栋门牌: string
  申请人: string
  联系电话: string
  经办人: string
  申请日期: string
  缴费日期: string
  申请表用热面积: string
  核定面积上限: string
  凭证编号: string
  凭证面积: string
}

function todayText(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function monthText(date: string): string {
  return date.slice(0, 7)
}

function toArea(value: string): number {
  return Number(value)
}

function padSerial(value: number): string {
  return String(value).padStart(4, '0')
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function makeCode(prefix: string, id: number): string {
  return `${prefix}-${padSerial(id)}`
}

function finishAction(rows: EntryRow[], index: number, patch: Partial<EntryRow>, pending: boolean): ActionResult {
  const current = rows[index]
  const nextRows = [...rows]
  nextRows[index] = { ...current, ...patch, pending }
  saveRows(HEAT_CONNECTION_KEY, nextRows)
  return { ok: true, message: `报装验收单 ${current.报装编号} 已更新为「${patch.status ?? current.status}」` }
}

function syncAcceptanceVisit(row: EntryRow): void {
  const serviceRows = [...listRows(HOUSEHOLD_SERVICE_KEY)]
  const sourceCode = String(row.报装编号)
  const index = serviceRows.findIndex((item) => String(item.来源单号) === sourceCode)
  const failed = row.验收结果 === '不合格'
  const serviceId = index >= 0 ? Number(serviceRows[index].id) : nextId(serviceRows)
  const service: EntryRow = {
    ...(index >= 0 ? serviceRows[index] : {}),
    id: serviceId,
    status: '已处理',
    pending: true,
    abnormal: failed,
    服务单号: index >= 0 ? serviceRows[index].服务单号 : makeCode('HOUS', serviceId),
    报修用户: `${row.申请人}（${row.小区名称}${row.楼栋门牌}）`,
    服务内容: `入网验收回访：${row.验收编号}`,
    受理人: row.经办人,
    上门时间: row.验收日期,
    处理结果: failed ? '验收不合格，整改后需复验并回访' : '验收合格，待并网回访',
    回访日期: '',
    来源单号: sourceCode,
    服务状态: '已处理',
  }
  if (index >= 0) {
    serviceRows[index] = service
  } else {
    serviceRows.push(service)
  }
  saveRows(HOUSEHOLD_SERVICE_KEY, serviceRows)
}

function runHeatConnectionAction(id: number, action: string): ActionResult {
  const meta = moduleMeta(HEAT_CONNECTION_KEY)
  const rows = listRows(HEAT_CONNECTION_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的报装验收单` }
  }

  const row = rows[index]
  const status = String(row.status)
  const today = todayText()

  if (action === '复核通过') {
    if (status !== '人工复核') return { ok: false, message: '只有人工复核中的报装单可以复核通过' }
    return finishAction(rows, index, {
      status: '已受理',
      pending: true,
      abnormal: false,
      复核日期: today,
      复核结论: '复核通过，材料齐备，准予受理',
      受理日期: today,
      受理判定: '人工复核通过，准予受理',
    }, true)
  }

  if (action === '驳回申请') {
    if (status !== '人工复核') return { ok: false, message: '只有人工复核中的报装单可以驳回' }
    return finishAction(rows, index, {
      status: '复核驳回',
      pending: false,
      abnormal: true,
      复核日期: today,
      复核结论: '超出小区核定范围，复核驳回',
    }, false)
  }

  if (action === '完成勘测') {
    if (status !== '已受理') return { ok: false, message: '报装单必须先受理，勘测不能提前办理' }
    return finishAction(rows, index, {
      status: '已勘测',
      勘测日期: today,
      勘测结论: '现场勘测完成，待签订供热合同',
    }, true)
  }

  if (action === '签订合同') {
    if (status !== '已勘测') return { ok: false, message: '未完成勘测的报装单不能签订供热合同' }
    if (row.合同状态 === '已签订') return { ok: false, message: '供热合同已经签妥，请勿重复签订' }
    const result = finishAction(rows, index, {
      合同状态: '已签订',
      合同编号: row.合同编号 || makeCode('HT', Number(row.id)),
      签订日期: today,
    }, true)
    return { ok: true, message: `报装验收单 ${row.报装编号} 的供热合同已签妥，可排期入网验收` }
  }

  if (action === '排期验收') {
    if (status !== '已勘测') return { ok: false, message: '验收必须排在勘测之后，不能跳级办理' }
    if (row.合同状态 !== '已签订') return { ok: false, message: '供热合同未签妥，不能排入网验收' }
    return finishAction(rows, index, {
      status: '待验收',
      验收编号: row.验收编号 || makeCode('YS', Number(row.id)),
      验收表用热面积: row.申请表用热面积,
      计划验收日期: today,
      验收结果: '',
    }, true)
  }

  if (action === '验收合格' || action === '验收不合格') {
    if (status !== '待验收') return { ok: false, message: '只有已排期的验收单可以登记验收结果' }
    const passed = action === '验收合格'
    const updated: EntryRow = {
      ...row,
      status: passed ? '待并网' : '验收不合格',
      pending: true,
      abnormal: !passed,
      验收日期: today,
      验收结果: passed ? '合格' : '不合格',
    }
    const nextRows = [...rows]
    nextRows[index] = updated
    saveRows(HEAT_CONNECTION_KEY, nextRows)
    syncAcceptanceVisit(updated)
    return {
      ok: true,
      message: passed ? '入网验收合格，已进入待并网清单，并生成入户待回访记录' : '入网验收不合格，已生成整改回访记录，暂不能并网',
    }
  }

  if (action === '整改复验') {
    if (status !== '验收不合格') return { ok: false, message: '只有验收不合格的单据可以申请整改复验' }
    return finishAction(rows, index, {
      status: '待验收',
      pending: true,
      abnormal: false,
      验收结果: '整改待复验',
      计划验收日期: today,
    }, true)
  }

  if (action === '办理并网') {
    if (status !== '待并网') return { ok: false, message: '验收未合格的报装单不能办理并网' }
    return finishAction(rows, index, {
      status: '已并网',
      并网日期: today,
      pending: false,
    }, false)
  }

  return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
}

export function createHeatConnection(input: HeatConnectionInput): ActionResult {
  const rows = listRows(HEAT_CONNECTION_KEY)
  const form = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, String(value ?? '').trim()]),
  ) as HeatConnectionInput

  const required: [keyof HeatConnectionInput, string][] = [
    ['小区名称', '小区名称'],
    ['楼栋门牌', '楼栋门牌'],
    ['申请人', '申请人'],
    ['经办人', '经办人'],
    ['申请日期', '申请日期'],
    ['缴费日期', '缴费日期'],
    ['申请表用热面积', '申请表用热面积'],
    ['核定面积上限', '小区核定面积上限'],
    ['凭证编号', '交费凭证编号'],
    ['凭证面积', '交费凭证载明面积'],
  ]
  const missing = required.find(([key]) => form[key] === '')
  if (missing) {
    return { ok: false, message: `报装申请缺交费凭证或材料不齐：${missing[1]}未填写，窗口不予收件` }
  }

  const applyArea = toArea(form.申请表用热面积)
  const approvedArea = toArea(form.核定面积上限)
  const voucherArea = toArea(form.凭证面积)
  if (![applyArea, approvedArea, voucherArea].every((value) => Number.isFinite(value) && value > 0)) {
    return { ok: false, message: '用热面积、核定面积和凭证面积必须为大于 0 的数字' }
  }
  if (voucherArea > approvedArea) {
    return { ok: false, message: '交费凭证载明面积超出小区核定范围，一律挡回' }
  }

  const duplicateKey = `${form.小区名称}|${form.楼栋门牌}|${form.申请人}`
  const duplicated = rows.some((row) =>
    `${row.小区名称}|${row.楼栋门牌}|${row.申请人}` === duplicateKey,
  )
  if (duplicated) {
    return { ok: false, message: '该户报装申请已在册，重复提交只算一次，不再新建台账' }
  }

  const id = nextId(rows)
  const crossMonth = monthText(form.缴费日期) > monthText(form.申请日期)
  const needsReview = applyArea > approvedArea
  const code = form.报装编号 || makeCode('RZ', id)
  const today = todayText()
  const row: EntryRow = {
    id,
    status: needsReview ? '人工复核' : '已受理',
    pending: true,
    abnormal: false,
    报装编号: code,
    小区名称: form.小区名称,
    楼栋门牌: form.楼栋门牌,
    申请人: form.申请人,
    联系电话: form.联系电话,
    经办人: form.经办人,
    申请日期: form.申请日期,
    缴费日期: form.缴费日期,
    资料分摞: crossMonth ? '跨月补交' : '正常受理',
    申请表用热面积: applyArea,
    核定面积上限: approvedArea,
    凭证编号: form.凭证编号,
    凭证面积: voucherArea,
    受理日期: needsReview ? '' : today,
    受理判定: needsReview ? '用热面积超出小区核定范围，转人工复核' : '材料齐备，符合受理条件',
    勘测日期: '',
    勘测结论: '',
    合同状态: '未签订',
    合同编号: '',
    签订日期: '',
    验收编号: '',
    验收表用热面积: '',
    计划验收日期: '',
    验收日期: '',
    验收结果: '',
    并网日期: '',
    复核日期: '',
    复核结论: '',
  }
  saveRows(HEAT_CONNECTION_KEY, [...rows, row])
  return {
    ok: true,
    message: needsReview
      ? `报装单 ${code} 已登记；用热面积超出核定范围，已转人工复核`
      : `报装单 ${code} 已受理${crossMonth ? '，跨月补交资料单独成摞' : ''}`,
  }
}

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
  if (key === HEAT_CONNECTION_KEY) {
    return runHeatConnectionAction(id, action)
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
