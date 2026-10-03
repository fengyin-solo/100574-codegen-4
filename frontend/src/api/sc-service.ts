import { resetScState, saveScState, scState } from '@/data/sc-store'
import { listRows, saveRows } from '@/data/local-store'
import {
  downloadEntries,
  listEntries,
  runAction,
} from '@/api/local-service'
import {
  SC_CALC_METHODS,
  SC_OP_MODES,
  SC_PRIMARY_MODE,
  SC_VOLTAGE_LEVELS,
} from '@/data/sc-types'
import type {
  ScMutateResult,
  ScSheetState,
  ScState,
  ScVersion,
  ScVersionInput,
} from '@/data/sc-types'
import type { EntryRow } from '@/data/types'

const SETTING_MODULE = 'settingvalue'

function nowText(): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function libraryLevels(): string[] {
  return [...SC_VOLTAGE_LEVELS]
}

export function opModes(): string[] {
  return [...SC_OP_MODES]
}

export function calcMethods(): string[] {
  return [...SC_CALC_METHODS]
}

/** 一组参数（电压等级 + 运行方式）当前的有效版本；失效旧版不参与整定计算。 */
export function activeVersion(state: ScState, voltageLevel: string, opMode: string): ScVersion | undefined {
  return state.versions.find(
    (v) => v.voltageLevel === voltageLevel && v.opMode === opMode && v.status === '有效',
  )
}

/** 一组参数最近一版（含已失效），历史台账用。 */
export function latestVersionOfGroup(state: ScState, voltageLevel: string, opMode: string): ScVersion | undefined {
  return state.versions
    .filter((v) => v.voltageLevel === voltageLevel && v.opMode === opMode)
    .sort((a, b) => b.id - a.id)[0]
}

/** 某电压等级是否还有任意有效取值：没有就整栏落到「待取值」。 */
export function levelHasValues(state: ScState, voltageLevel: string): boolean {
  return state.versions.some((v) => v.voltageLevel === voltageLevel && v.status === '有效')
}

/** 最近一次整定计算采用的版本：冲突时以这版为准。 */
export function adoptedVersion(state: ScState, voltageLevel: string): ScVersion | undefined {
  const adoption = state.adopted[voltageLevel]
  if (!adoption) {
    return undefined
  }
  return state.versions.find((v) => v.id === adoption.versionId)
}

export type LevelCard = {
  voltageLevel: string
  hasValues: boolean
  /** 整定计算取用的那一版（最大运行方式）。 */
  primary: ScVersion | undefined
  /** 最近一次整定采用的版本，可能已是失效旧版。 */
  adopted: ScVersion | undefined
  /** 最近一次整定采用的出处（定值单号、采用时间）。 */
  adoptedInfo: ScState['adopted'][string] | undefined
  /** 新版有效但整定还没采用：true 表示存在冲突待重算。 */
  newerThanAdopted: boolean
  modes: { opMode: string; version: ScVersion | undefined; adopted: boolean }[]
}

export function levelCards(state: ScState): LevelCard[] {
  return SC_VOLTAGE_LEVELS.map((voltageLevel) => {
    const primary = activeVersion(state, voltageLevel, SC_PRIMARY_MODE)
    const adoptedInfo = state.adopted[voltageLevel]
    const adopted = adoptedVersion(state, voltageLevel)
    return {
      voltageLevel,
      hasValues: levelHasValues(state, voltageLevel),
      primary,
      adopted,
      adoptedInfo,
      newerThanAdopted: !!primary && !!adopted && primary.id !== adopted.id,
      modes: SC_OP_MODES.map((opMode) => ({
        opMode,
        version: activeVersion(state, voltageLevel, opMode),
        adopted: adopted?.id === activeVersion(state, voltageLevel, opMode)?.id,
      })),
    }
  })
}

/** 历史台账：失效版本以及全部提交记录，按时间倒序。 */
export function historyVersions(state: ScState): ScVersion[] {
  return [...state.versions].sort((a, b) => b.id - a.id)
}

function normalize(input: ScVersionInput): ScVersionInput {
  return {
    voltageLevel: input.voltageLevel.trim(),
    opMode: input.opMode.trim(),
    calcMethod: input.calcMethod.trim(),
    systemImpedance: input.systemImpedance.trim(),
    shortCircuitCurrent: input.shortCircuitCurrent.trim(),
    source: input.source.trim(),
    valuedAt: input.valuedAt.trim(),
  }
}

function samePayload(a: ScVersion, b: ScVersionInput): boolean {
  return (
    a.calcMethod === b.calcMethod &&
    a.systemImpedance === b.systemImpedance &&
    a.shortCircuitCurrent === b.shortCircuitCurrent &&
    a.source === b.source &&
    a.valuedAt === b.valuedAt
  )
}

export function validateInput(input: ScVersionInput): string {
  const value = normalize(input)
  if (!SC_VOLTAGE_LEVELS.includes(value.voltageLevel as (typeof SC_VOLTAGE_LEVELS)[number])) {
    return '电压等级不在参数库登记范围内'
  }
  if (!SC_OP_MODES.includes(value.opMode as (typeof SC_OP_MODES)[number])) {
    return '运行方式取值不合法'
  }
  if (!SC_CALC_METHODS.includes(value.calcMethod as (typeof SC_CALC_METHODS)[number])) {
    return '请选择计算方式'
  }
  if (value.systemImpedance === '') {
    return '请填写系统阻抗'
  }
  if (value.shortCircuitCurrent === '' || Number.isNaN(Number(value.shortCircuitCurrent))) {
    return '三相短路电流需填写数值（单位 kA）'
  }
  if (value.source === '') {
    return '请填写参数来源（运行方式下达单/计算书等）'
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.valuedAt)) {
    return '取值日期请按 年-月-日 填写'
  }
  return ''
}

/**
 * 提交一版取值：
 * - 同一组参数重复提交且完全相同：只保留现有版本，不再生成新版；
 * - 数值等字段有变化：旧有效版置为已失效（留痕、不再参与整定），写入新版；
 * - 参数来源、取值日期一并落库。
 */
export function submitVersion(raw: ScVersionInput): ScMutateResult {
  const validation = validateInput(raw)
  if (validation) {
    return { ok: false, message: validation }
  }
  const input = normalize(raw)
  const state = scState()
  const latest = latestVersionOfGroup(state, input.voltageLevel, input.opMode)
  if (latest && latest.status === '有效' && samePayload(latest, input)) {
    return { ok: false, message: '与当前有效版本完全相同，已保留最新一版，未重复入库' }
  }

  const version: ScVersion = {
    id: state.nextId,
    ...input,
    submittedAt: nowText(),
    status: '有效',
  }
  const versions = state.versions.map((v) =>
    v.voltageLevel === input.voltageLevel && v.opMode === input.opMode && v.status === '有效'
      ? { ...v, status: '已失效' as const, supersededById: version.id }
      : v,
  )
  versions.push(version)
  saveScState({ ...state, versions, nextId: state.nextId + 1 })
  return {
    ok: true,
    message: `${input.voltageLevel} ${input.opMode}取值已更新为新版本（编号 #${version.id}），旧版已失效，待相关定值重算`,
    versionId: version.id,
  }
}

/** 判定一张定值单相对于参数库的取用状态。 */
export function sheetState(row: EntryRow): ScSheetState {
  const state = scState()
  const voltageLevel = String(row['电压等级'] ?? '')
  const primary = activeVersion(state, voltageLevel, SC_PRIMARY_MODE)
  if (!primary) {
    return '参数未取值'
  }
  const adoptedId = Number(row['采用参数版本'])
  if (!Number.isFinite(adoptedId) || adoptedId <= 0) {
    return '待采用'
  }
  return adoptedId === primary.id ? '一致' : '待重算'
}

/** 定值单展示的短路电流直接取参数库，两处始终是同一份数据。 */
export function sheetCurrent(row: EntryRow): { text: string; version?: ScVersion; stale: boolean } {
  const state = scState()
  const voltageLevel = String(row['电压等级'] ?? '')
  const primary = activeVersion(state, voltageLevel, SC_PRIMARY_MODE)
  if (!primary) {
    return { text: '参数未取值', stale: false }
  }
  const adoptedId = Number(row['采用参数版本'])
  if (Number.isFinite(adoptedId) && adoptedId > 0) {
    const adopted = state.versions.find((v) => v.id === adoptedId)
    if (adopted) {
      return { text: `${adopted.shortCircuitCurrent} kA`, version: adopted, stale: adopted.id !== primary.id }
    }
  }
  return { text: `${primary.shortCircuitCurrent} kA`, version: primary, stale: false }
}

export type RecalcItem = {
  row: EntryRow
  voltageLevel: string
  state: Extract<ScSheetState, '待重算' | '待采用'>
  currentText: string
  latestText: string
}

/** 待重算清单：参数变更后仍引用旧版（待重算），或该等级还没做过整定计算（待采用）。 */
export function recalcList(): RecalcItem[] {
  const rows = listRows(SETTING_MODULE)
  const items: RecalcItem[] = []
  for (const row of rows) {
    if (row.status === '已作废') {
      continue
    }
    const stateOfSheet = sheetState(row)
    if (stateOfSheet !== '待重算' && stateOfSheet !== '待采用') {
      continue
    }
    const voltageLevel = String(row['电压等级'] ?? '')
    const state = scState()
    const primary = activeVersion(state, voltageLevel, SC_PRIMARY_MODE)
    items.push({
      row,
      voltageLevel,
      state: stateOfSheet,
      currentText: sheetCurrent(row).text,
      latestText: primary ? `${primary.shortCircuitCurrent} kA` : '—',
    })
  }
  return items
}

export function pendingRecalcCount(): number {
  return recalcList().length
}

/**
 * 按最新参数重算：把该电压等级最近一版最大运行方式参数标记为「最近一次整定计算采用」，
 * 并回写定值单，旧版参数下的定值即从待重算清单中消除。
 */
export function adoptForSetting(rowId: number, operator = '值班管理员'): ScMutateResult {
  const rows = listRows(SETTING_MODULE)
  const index = rows.findIndex((row) => Number(row.id) === rowId)
  if (index < 0) {
    return { ok: false, message: '没有找到这张定值单' }
  }
  const row = rows[index]
  const voltageLevel = String(row['电压等级'] ?? '')
  const state = scState()
  const primary = activeVersion(state, voltageLevel, SC_PRIMARY_MODE)
  if (!primary) {
    return { ok: false, message: `${voltageLevel}参数尚未取值，无法整定计算，请先在参数库登记` }
  }

  const settingNo = String(row['定值单号'] ?? `SETT-${rowId}`)
  const adoptedAt = nowText()
  const nextState: ScState = {
    ...state,
    adopted: {
      ...state.adopted,
      [voltageLevel]: { versionId: primary.id, adoptedAt, settingNo, operator },
    },
  }
  saveScState(nextState)

  // 两处短路电流是同一份：定值单只保存版本指针，展示时回参数库取数。
  const nextRow: EntryRow = {
    ...row,
    采用参数版本: primary.id,
    采用时间: adoptedAt,
    短路电流: `${primary.shortCircuitCurrent}kA`,
    计算依据: `${primary.source}（${voltageLevel} ${primary.opMode}，取值${primary.valuedAt}）`,
    status: '整定中',
    pending: true,
    abnormal: false,
  }
  const nextRows = [...rows]
  nextRows[index] = nextRow
  saveRows(SETTING_MODULE, nextRows)
  return { ok: true, message: `${settingNo} 已按 #${primary.id} 版参数（${primary.shortCircuitCurrent}kA）重新整定` }
}

export function resetLibrary(): void {
  resetScState()
}

// 台账通用入口转出：定值页只从参数库服务取数，保证短路电流口径一致。
export { downloadEntries, listEntries, runAction }
