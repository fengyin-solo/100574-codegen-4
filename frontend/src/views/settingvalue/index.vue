<template>
  <section class="page" data-module="settingvalue">
    <header class="page-head">
      <div>
        <h2>定值整定管理</h2>
        <p class="page-desc">维护定值单，围绕定值单号、所属装置、定值项目、整定值做登记、筛选与状态流转；短路电流与短路电流参数库为同一份数据。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记定值单</button>
        <button class="btn" type="button" @click="exportRows">导出定值整定清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 参数变更后的待重算清单 -->
    <section class="recalc-card" :class="{ 'recalc-has': recalcItems.length }">
      <header class="recalc-head">
        <h3>待重算清单（参数库取值变更触发）</h3>
        <span class="tag" :class="recalcItems.length ? 'tag-alert' : 'tag-ok'">{{ recalcItems.length }} 张</span>
      </header>
      <p v-if="!recalcItems.length" class="recalc-empty">所有在册定值单均与参数库当前有效版本一致。</p>
      <table v-else class="data-table recalc-table">
        <thead>
          <tr>
            <th>定值单号</th><th>电压等级</th><th>现采用短路电流</th><th>参数库最新值</th>
            <th>差异类型</th><th>处理</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in recalcItems" :key="String(item.row.id)">
            <td>{{ item.row['定值单号'] }}</td>
            <td>{{ item.voltageLevel }}</td>
            <td>{{ item.currentText }}</td>
            <td class="latest-current">{{ item.latestText }}</td>
            <td>
              <span class="tag" :class="item.state === '待重算' ? 'tag-alert' : 'tag-warn'">
                {{ item.state === '待重算' ? '参数已变更' : '参数已备，未整定采用' }}
              </span>
            </td>
            <td>
              <button class="link" type="button" @click="recalc(item.row.id)">按最新参数重算</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

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
          <th>参数版本</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '短路电流'">
              <span :class="{ 'current-stale': currentOf(row).stale }">{{ currentOf(row).text }}</span>
            </template>
            <template v-else>{{ row[column] === '' ? '—' : row[column] ?? '—' }}</template>
          </td>
          <td>
            <span v-if="stateOf(row) === '一致'" class="tag tag-ok">一致 #{{ row['采用参数版本'] }}</span>
            <span v-else-if="stateOf(row) === '待重算'" class="tag tag-alert">待重算 #{{ row['采用参数版本'] }}</span>
            <span v-else-if="stateOf(row) === '待采用'" class="tag tag-warn">待采用</span>
            <span v-else class="tag tag-dead">参数未取值</span>
          </td>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无定值整定数据，可先登记定值单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条定值整定记录；短路电流取自参数库，两处保持同一份</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  adoptForSetting,
  downloadEntries,
  listEntries,
  recalcList,
  runAction as applyAction,
  sheetCurrent,
  sheetState,
} from '@/api/sc-service'
import { moduleMeta } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('settingvalue')
const columns = ["定值单号", "电压等级", "所属装置", "定值项目", "整定值", "短路电流", "计算依据", "采用时间", "整定人", "审核人", "定值状态"]
const actions = ["提交整定", "审核定值", "作废定值"]
const statuses = ["待整定", "整定中", "已审核", "已作废"]
const stats = [{"label": "待整定定值单", "value": 0}, {"label": "整定中定值单", "value": 0}, {"label": "已作废定值单", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const recalcItems = ref(recalcList())

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function stateOf(row: EntryRow) {
  return sheetState(row)
}

function currentOf(row: EntryRow) {
  return sheetCurrent(row)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '定值单登记入口尚未接入审批流'
}

function recalc(id: number) {
  errorMessage.value = ''
  const result = adoptForSetting(id)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    recalcItems.value = recalcList()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '定值整定列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.recalc-card {
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 12px; margin-bottom: 14px;
}
.recalc-card.recalc-has { border-color: #fda29b; background: #fffdfc; }
.recalc-head { display: flex; align-items: center; gap: 10px; }
.recalc-head h3 { font-size: 14px; margin: 0; }
.recalc-empty { margin: 8px 0 0; font-size: 12px; color: var(--muted); }
.recalc-table { margin-top: 8px; }
.latest-current { font-weight: 700; color: #1f6feb; }
.current-stale { color: #b42318; font-weight: 600; }
.tag { font-size: 11px; border-radius: 999px; padding: 1px 8px; white-space: nowrap; }
.tag-ok { background: #dcfae6; color: #067647; }
.tag-warn { background: #fef0c7; color: #b54708; }
.tag-alert { background: #fee4e2; color: #b42318; }
.tag-dead { background: #e5e7eb; color: #6b7280; }
</style>
