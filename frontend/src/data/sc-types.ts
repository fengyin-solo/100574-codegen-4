/** 短路电流与系统阻抗参数库：按「电压等级 + 运行方式」分组做版本管理。 */

// 参数库固定登记的电压等级：还没有任何有效取值的等级会单独落在「待取值」栏。
export const SC_VOLTAGE_LEVELS = ['500kV', '220kV', '110kV', '35kV', '10kV'] as const

// 参数随运行方式重新取值：整定计算一般取最大运行方式下的三相短路电流。
export const SC_OP_MODES = ['最大运行方式', '正常运行方式', '最小运行方式'] as const

export const SC_CALC_METHODS = ['有名值换算法', '标幺值换算法', '调度下达'] as const

// 整定计算取用的运行方式：冲突仲裁、待重算判定都以这一版为准。
export const SC_PRIMARY_MODE = '最大运行方式'

export type ScVersionStatus = '有效' | '已失效'

export type ScVersion = {
  id: number
  voltageLevel: string
  opMode: string
  calcMethod: string
  /** 系统阻抗：有名值填 Ω，标幺值换算法可填标幺值并注明基准容量。 */
  systemImpedance: string
  /** 三相短路电流，单位 kA。 */
  shortCircuitCurrent: string
  source: string
  /** 取值日期：参数来源文件上的日期。 */
  valuedAt: string
  /** 提交时间：本次登记入库的时间。 */
  submittedAt: string
  status: ScVersionStatus
  /** 被哪一版替代，便于历史台账追溯。 */
  supersededById?: number
}

export type ScAdoption = {
  /** 最近一次整定计算实际采用的参数版本。 */
  versionId: number
  adoptedAt: string
  settingNo: string
  operator: string
}

export type ScState = {
  versions: ScVersion[]
  /** 按电压等级记录最近一次整定计算采用的版本（冲突时以它为准）。 */
  adopted: Record<string, ScAdoption>
  nextId: number
}

export type ScVersionInput = {
  voltageLevel: string
  opMode: string
  calcMethod: string
  systemImpedance: string
  shortCircuitCurrent: string
  source: string
  valuedAt: string
}

export type ScMutateResult = {
  ok: boolean
  message: string
  versionId?: number
}

//定值单与参数库比对后的取用状态。
export type ScSheetState =
  | '一致'
  | '待重算' // 参数库已有新版，定值单仍挂在最近整定采用的旧版上
  | '待采用' // 参数库有取值，但该电压等级还没做过整定计算
  | '参数未取值' // 定值单所需电压等级在参数库里完全没有取值
