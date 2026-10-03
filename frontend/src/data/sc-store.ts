import { buildSeedScState } from './sc-seed'
import type { ScState } from './sc-types'

// 参数库与台账分开存：参数库有自己的版本与整定采用记录。
const STORAGE_KEY = 'substation-protection:sc-params'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): ScState {
  const fallback = buildSeedScState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ScState>
    // 老缓存缺字段时用种子补齐，避免版本迭代后页面读到半截数据。
    return {
      versions: Array.isArray(parsed.versions) ? parsed.versions : clone(fallback.versions),
      adopted: parsed.adopted && typeof parsed.adopted === 'object' ? parsed.adopted : clone(fallback.adopted),
      nextId: typeof parsed.nextId === 'number' ? parsed.nextId : fallback.nextId,
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: ScState | null = null

export function scState(): ScState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveScState(state: ScState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function resetScState(): ScState {
  const fresh = buildSeedScState()
  saveScState(fresh)
  return fresh
}

export function scStorageKey(): string {
  return STORAGE_KEY
}
