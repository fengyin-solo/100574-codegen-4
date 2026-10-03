<template>
  <section class="page" data-module="shortcircuit">
    <header class="page-head">
      <div>
        <h2>短路电流与系统阻抗参数库</h2>
        <p class="page-desc">
          按电压等级分栏维护计算方式、系统阻抗与三相短路电流；同一电压等级只保留最新一版，旧版不再参与整定计算。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleForm">
          {{ showForm ? '收起取值单' : '取值登记' }}
        </button>
        <button class="btn" type="button" @click="reconcile">一致性核对</button>
        <button class="btn" type="button" @click="exportRows">导出参数清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form v-if="showForm" class="filter-bar param-form" @submit.prevent="submit">
      <label class="filter-item">
        <span>电压等级</span>
        <input v-model="form.电压等级" list="level-options" placeholder="如 110kV" />
        <datalist id="level-options">
          <option v-for="level in standardLevels" :key="level" :value="level" />
        </datalist>
      </label>
      <label class="filter-item">
        <span>计算方式</span>
        <select v-model="form.计算方式">
          <option v-for="method in calcMethods" :key="method" :value="method">{{ method }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>系统阻抗（Ω）</span>
        <input v-model="form.系统阻抗" placeholder="如 2.02" />
      </label>
      <label class="filter-item">
        <span>三相短路电流（kA）</span>
        <input v-model="form.三相短路电流" placeholder="如 31.5" />
      </label>
      <label class="filter-item">
        <span>参数来源</span>
        <select v-model="form.参数来源">
          <option v-for="source in paramSources" :key="source" :value="source">{{ source }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>取值日期</span>
        <input v-model="form.取值日期" type="date" />
      </label>
      <button class="btn primary" type="submit">提交取值</button>
    </form>

    <p v-if="message" class="notice" :class="{ error: isError }">{{ message }}</p>

    <div class="level-board">
      <article v-for="col in columns" :key="col.level" class="level-col">
        <h3>{{ col.level }}</h3>
        <dl>
          <div><dt>计算方式</dt><dd>{{ col.current['计算方式'] }}</dd></div>
          <div><dt>系统阻抗</dt><dd>{{ col.current['系统阻抗'] }} Ω</dd></div>
          <div><dt>三相短路电流</dt><dd>{{ col.current['三相短路电流'] }} kA</dd></div>
          <div><dt>参数来源</dt><dd>{{ col.current['参数来源'] }}</dd></div>
          <div><dt>取值日期</dt><dd>{{ col.current['取值日期'] }}</dd></div>
        </dl>
        <p class="level-tag">现行版本 {{ tag(col.current) }}</p>
      </article>
      <article class="level-col unset">
        <h3>未取值</h3>
        <ul v-if="unsetLevels.length">
          <li v-for="level in unsetLevels" :key="level">{{ level }}</li>
        </ul>
        <p v-else class="unset-hint">各电压等级均已取值</p>
        <p class="unset-hint">未取值的等级不参与整定计算，提交取值后自动出列。</p>
      </article>
    </div>

    <template v-if="resolutions.length">
      <h3 class="section-title">一致性核对结果（取值冲突按最近一次整定计算采用的版本对齐）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>电压等级</th>
            <th>定值单号</th>
            <th>定值采用版本</th>
            <th>参数库原现行</th>
            <th>处理结果</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in resolutions" :key="`${item.电压等级}-${item.定值单号}`">
            <td>{{ item.电压等级 }}</td>
            <td>{{ item.定值单号 }}</td>
            <td>{{ item.定值采用版本 }}</td>
            <td>{{ item.参数库原现行 }}</td>
            <td>{{ item.处理结果 }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <h3 class="section-title">版本记录（旧版不再参与整定计算）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in versionColumns" :key="column">{{ column }}</th>
          <th>当前状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in versions" :key="String(row.id)" :class="{ stale: row.status === '历史' }">
          <td v-for="column in versionColumns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
        </tr>
        <tr v-if="!versions.length">
          <td :colspan="versionColumns.length + 1" class="empty-state">暂无参数记录，可先取值登记</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ columns.length }} 个电压等级已取值 · {{ unsetLevels.length }} 个未取值</span>
      <span>
        待重算定值单 {{ recalcCount }} 张
        <RouterLink v-if="recalcCount" to="/settingvalue" class="link">前往定值整定处理</RouterLink>
      </span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  CALC_METHODS,
  MODULE_KEY,
  PARAM_SOURCES,
  STANDARD_LEVELS,
  listLevelColumns,
  listRecalcQueue,
  listVersions,
  reconcileWithSettings,
  submitParam,
  todayString,
  versionTag,
} from '@/api/shortcircuit'
import type { ConflictResolution, LevelColumn } from '@/api/shortcircuit'
import type { EntryRow } from '@/data/types'

const versionColumns = ['电压等级', '计算方式', '系统阻抗', '三相短路电流', '参数来源', '取值日期', '版本']
const standardLevels = STANDARD_LEVELS
const calcMethods = CALC_METHODS
const paramSources = PARAM_SOURCES

const columns = ref<LevelColumn[]>([])
const unsetLevels = ref<string[]>([])
const versions = ref<EntryRow[]>([])
const recalcCount = ref(0)
const resolutions = ref<ConflictResolution[]>([])
const showForm = ref(false)
const message = ref('')
const isError = ref(false)

const blankForm = () => ({
  电压等级: '',
  计算方式: calcMethods[0],
  系统阻抗: '',
  三相短路电流: '',
  参数来源: paramSources[0],
  取值日期: todayString(),
})
const form = ref(blankForm())

const stats = computed(() => [
  { label: '已取值电压等级', value: columns.value.length },
  { label: '未取值电压等级', value: unsetLevels.value.length },
  { label: '历史版本', value: versions.value.filter((row) => row.status === '历史').length },
  { label: '待重算定值单', value: recalcCount.value },
])

function tag(row: EntryRow): string {
  return versionTag(row)
}

function toggleForm() {
  showForm.value = !showForm.value
}

function notify(text: string, failed: boolean) {
  message.value = text
  isError.value = failed
}

function submit() {
  const result = submitParam(form.value)
  notify(result.message, !result.ok)
  if (result.ok) {
    form.value = blankForm()
    showForm.value = false
    resolutions.value = []
  }
  reload()
}

function reconcile() {
  const result = reconcileWithSettings()
  resolutions.value = result.resolutions
  notify(result.message, false)
  reload()
}

function exportRows() {
  downloadEntries(MODULE_KEY)
}

function reload() {
  const board = listLevelColumns()
  columns.value = board.columns
  unsetLevels.value = board.unsetLevels
  versions.value = listVersions()
  recalcCount.value = listRecalcQueue().length
}

onMounted(reload)
</script>
