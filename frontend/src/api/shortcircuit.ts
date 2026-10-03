import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 短路电流与系统阻抗参数库的业务规则都收在这里，页面只负责渲染：
// 1. 同一电压等级只保留最新一版为「现行」，旧版转「历史」，不再参与整定计算；
// 2. 同一组参数（电压等级+计算方式+阻抗+电流）重复提交时只保留最新一版，不另起版本；
// 3. 参数库与定值单的短路电流须是同一份，冲突时按最近一次整定计算采用的那版对齐；
// 4. 取值变更后，受影响的定值单落入定值整定的「待重算清单」。
export const MODULE_KEY = 'shortcircuit'
export const SETTING_KEY = 'settingvalue'

// 站内标准电压等级：没有现行参数的等级进「未取值」一栏。
export const STANDARD_LEVELS = ['220kV', '110kV', '35kV', '10kV']

export const CALC_METHODS = ['最大运行方式', '最小运行方式']
export const PARAM_SOURCES = ['调度下发', '实测计算', '厂家资料', '设计资料']

export type ParamInput = {
  电压等级: string
  计算方式: string
  系统阻抗: string
  三相短路电流: string
  参数来源: string
  取值日期: string
}

export type LevelColumn = {
  level: string
  current: EntryRow
}

export type ConflictResolution = {
  电压等级: string
  定值单号: string
  定值采用版本: string
  参数库原现行: string
  处理结果: string
}

export type ReconcileResult = {
  resolutions: ConflictResolution[]
  marked: number
  message: string
}

export function todayString(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function versionNo(row: EntryRow): number {
  const match = String(row['版本'] ?? '').match(/^V(\d+)$/)
  return match ? Number(match[1]) : 0
}

export function versionTag(row: EntryRow): string {
  return `SC-${row['电压等级']}-${row['版本']}`
}

function currentOf(level: string): EntryRow | undefined {
  return listRows(MODULE_KEY).find((row) => row['电压等级'] === level && row.status === '现行')
}

/** 按电压等级分栏：已取值的逐栏给出现行参数，没取值的等级单独归一栏。 */
export function listLevelColumns(): { columns: LevelColumn[]; unsetLevels: string[] } {
  const rows = listRows(MODULE_KEY)
  const levels = [...new Set([...STANDARD_LEVELS, ...rows.map((row) => String(row['电压等级']))])]
  const columns: LevelColumn[] = []
  const unsetLevels: string[] = []
  for (const level of levels) {
    const current = rows.find((row) => row['电压等级'] === level && row.status === '现行')
    if (current) {
      columns.push({ level, current })
    } else {
      unsetLevels.push(level)
    }
  }
  return { columns, unsetLevels }
}

/** 版本记录：按电压等级归组、版本号倒序，历史版本保留备查但不参与整定计算。 */
export function listVersions(): EntryRow[] {
  return [...listRows(MODULE_KEY)].sort((a, b) => {
    const byLevel = String(a['电压等级']).localeCompare(String(b['电压等级']), 'zh-Hans-CN')
    return byLevel !== 0 ? byLevel : versionNo(b) - versionNo(a)
  })
}

function isPositiveNumber(text: string): boolean {
  const value = Number(text)
  return text.trim() !== '' && Number.isFinite(value) && value > 0
}

/** 取值变更后，把还在引用旧版参数的定值单落入待重算清单。 */
function markRecalcForLevel(level: string): number {
  const current = currentOf(level)
  if (!current) {
    return 0
  }
  const tag = versionTag(current)
  const settings = listRows(SETTING_KEY)
  let count = 0
  const next = settings.map((sheet) => {
    const basis = String(sheet['计算依据'] ?? '')
    const status = String(sheet.status)
    if (!basis.includes(`SC-${level}-`) || basis.includes(tag)) {
      return sheet
    }
    if (status === '已作废' || status === '待整定' || sheet['重算状态'] === '待重算') {
      return sheet
    }
    count += 1
    return { ...sheet, 重算状态: '待重算', pending: true }
  })
  if (count > 0) {
    saveRows(SETTING_KEY, next)
  }
  return count
}

/** 取值登记：新版本设为现行，同电压等级旧版全部转历史；重复提交只保留最新一版。 */
export function submitParam(input: ParamInput): ActionResult {
  const level = input.电压等级.trim()
  const method = input.计算方式.trim()
  const impedance = input.系统阻抗.trim()
  const current = input.三相短路电流.trim()
  const source = input.参数来源.trim()
  const date = input.取值日期.trim()
  if (!level || !method || !source || !date) {
    return { ok: false, message: '电压等级、计算方式、参数来源、取值日期都不能为空' }
  }
  if (!isPositiveNumber(impedance) || !isPositiveNumber(current)) {
    return { ok: false, message: '系统阻抗与三相短路电流须为大于 0 的数值' }
  }
  const rows = listRows(MODULE_KEY)
  const siblings = rows.filter((row) => row['电压等级'] === level)
  const existing = siblings.find((row) => row.status === '现行')
  if (
    existing &&
    existing['计算方式'] === method &&
    String(existing['系统阻抗']) === impedance &&
    String(existing['三相短路电流']) === current
  ) {
    // 同一组参数重复提交：不另起版本，只刷新最新一版的来源与取值日期。
    const next = rows.map((row) =>
      Number(row.id) === Number(existing.id) ? { ...row, 参数来源: source, 取值日期: date } : row,
    )
    saveRows(MODULE_KEY, next)
    return {
      ok: true,
      message: `${level} 同一组参数重复提交，只保留最新一版 ${versionTag(existing)}，已更新参数来源与取值日期`,
    }
  }
  const version = Math.max(0, ...siblings.map(versionNo)) + 1
  const id = Math.max(0, ...rows.map((row) => Number(row.id))) + 1
  const row: EntryRow = {
    id,
    status: '现行',
    pending: false,
    abnormal: false,
    电压等级: level,
    计算方式: method,
    系统阻抗: impedance,
    三相短路电流: current,
    参数来源: source,
    取值日期: date,
    版本: `V${version}`,
    参数状态: '现行',
  }
  const next = rows.map((item) =>
    item['电压等级'] === level ? { ...item, status: '历史', 参数状态: '历史' } : item,
  )
  next.push(row)
  saveRows(MODULE_KEY, next)
  const recalc = markRecalcForLevel(level)
  return {
    ok: true,
    message: `${level} 已按${method}重新取值，现行版本 ${versionTag(row)}，旧版转入历史不再参与整定计算；${recalc} 张定值单落入待重算清单`,
  }
}

function parseBasis(basis: string): { level: string; version: string } | null {
  const match = basis.match(/SC-(.+?)-(V\d+)/)
  return match ? { level: match[1], version: match[2] } : null
}

/**
 * 一致性核对：参数库与定值单的短路电流须是同一份。
 * 取值冲突时按最近一次整定计算（引用该等级且编号最大的定值单）采用的那版对齐参数库，
 * 对齐后仍引用旧版的定值单落入待重算清单。
 */
export function reconcileWithSettings(): ReconcileResult {
  const settings = listRows(SETTING_KEY).filter((sheet) => String(sheet.status) !== '已作废')
  const latestByLevel = new Map<string, EntryRow>()
  for (const sheet of settings) {
    const ref = parseBasis(String(sheet['计算依据'] ?? ''))
    if (!ref) {
      continue
    }
    const prev = latestByLevel.get(ref.level)
    if (!prev || Number(sheet.id) > Number(prev.id)) {
      latestByLevel.set(ref.level, sheet)
    }
  }
  const resolutions: ConflictResolution[] = []
  let rows = listRows(MODULE_KEY)
  let changed = false
  for (const [level, sheet] of latestByLevel) {
    const adopted = parseBasis(String(sheet['计算依据']))!.version
    const current = rows.find((row) => row['电压等级'] === level && row.status === '现行')
    if (current && current['版本'] === adopted) {
      continue
    }
    const base: Omit<ConflictResolution, '处理结果'> = {
      电压等级: level,
      定值单号: String(sheet['定值单号'] ?? sheet.id),
      定值采用版本: adopted,
      参数库原现行: current ? String(current['版本']) : '未取值',
    }
    const inLibrary = rows.find((row) => row['电压等级'] === level && row['版本'] === adopted)
    if (inLibrary) {
      rows = rows.map((row) =>
        row['电压等级'] === level
          ? {
              ...row,
              status: Number(row.id) === Number(inLibrary.id) ? '现行' : '历史',
              参数状态: Number(row.id) === Number(inLibrary.id) ? '现行' : '历史',
            }
          : row,
      )
      resolutions.push({ ...base, 处理结果: `参数库现行版本已按定值单切换为 ${adopted}` })
      changed = true
      continue
    }
    const basis = String(sheet['计算依据'])
    const impedance = basis.match(/系统阻抗\s*([\d.]+)\s*Ω/)
    const faultCurrent = basis.match(/三相短路电流\s*([\d.]+)\s*kA/)
    if (impedance && faultCurrent) {
      const id = Math.max(0, ...rows.map((row) => Number(row.id))) + 1
      rows = rows.map((row) =>
        row['电压等级'] === level ? { ...row, status: '历史', 参数状态: '历史' } : row,
      )
      rows.push({
        id,
        status: '现行',
        pending: false,
        abnormal: false,
        电压等级: level,
        计算方式: '按定值单计算依据补登',
        系统阻抗: impedance[1],
        三相短路电流: faultCurrent[1],
        参数来源: `定值单 ${base.定值单号}`,
        取值日期: todayString(),
        版本: adopted,
        参数状态: '现行',
      })
      resolutions.push({ ...base, 处理结果: `定值单采用的 ${adopted} 在参数库缺失，已按计算依据补登并设为现行` })
      changed = true
    } else {
      resolutions.push({ ...base, 处理结果: '定值单采用的版本在参数库缺失且计算依据无法解析，需人工补登' })
    }
  }
  if (changed) {
    saveRows(MODULE_KEY, rows)
  }
  let marked = 0
  const levels = new Set([...latestByLevel.keys(), ...rows.map((row) => String(row['电压等级']))])
  for (const level of levels) {
    marked += markRecalcForLevel(level)
  }
  const message =
    resolutions.length === 0
      ? marked === 0
        ? '参数库与定值单的短路电流取值一致，未发现冲突'
        : `参数库与定值单版本一致，另有 ${marked} 张定值单仍引用旧版参数，已落入待重算清单`
      : `发现 ${resolutions.length} 处取值冲突，已按最近一次整定计算采用的版本对齐；${marked} 张定值单落入待重算清单`
  return { resolutions, marked, message }
}

/** 定值整定的待重算清单。 */
export function listRecalcQueue(): EntryRow[] {
  return listRows(SETTING_KEY).filter((sheet) => sheet['重算状态'] === '待重算')
}

/** 完成重算：计算依据对齐参数库现行版本，移出待重算清单。 */
export function completeRecalc(id: number): ActionResult {
  const settings = listRows(SETTING_KEY)
  const index = settings.findIndex((sheet) => Number(sheet.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的定值单` }
  }
  const sheet = settings[index]
  if (sheet['重算状态'] !== '待重算') {
    return { ok: false, message: '该定值单不在待重算清单中' }
  }
  const ref = parseBasis(String(sheet['计算依据'] ?? ''))
  let basis = String(sheet['计算依据'] ?? '')
  if (ref) {
    const current = currentOf(ref.level)
    if (current) {
      basis = `${versionTag(current)}｜系统阻抗${current['系统阻抗']}Ω｜三相短路电流${current['三相短路电流']}kA`
    }
  }
  const next = [...settings]
  next[index] = { ...sheet, 计算依据: basis, 重算状态: '', pending: false }
  saveRows(SETTING_KEY, next)
  return { ok: true, message: `定值单 ${sheet['定值单号']} 已完成重算，计算依据已对齐参数库现行版本` }
}
