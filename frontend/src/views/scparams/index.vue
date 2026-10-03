<template>
  <section class="page" data-module="scparams">
    <header class="page-head">
      <div>
        <h2>短路电流与系统阻抗参数库</h2>
        <p class="page-desc">
          按电压等级分栏登记计算方式、系统阻抗与三相短路电流，记录参数来源与取值日期。参数随运行方式重新取值，同一组参数只保留最新一版，旧版失效后不再参与整定计算。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetLibrary">恢复示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">已取值电压等级</span>
        <strong class="stat-value">{{ valuedCount }} / {{ cards.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">有效参数版本</span>
        <strong class="stat-value">{{ activeCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待取值电压等级</span>
        <strong class="stat-value">{{ pendingLevels.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">定值整定待重算</span>
        <strong class="stat-value" :class="{ 'stat-alert': recalcCount > 0 }">{{ recalcCount }}</strong>
      </article>
    </div>

    <div class="sc-banner" v-if="recalcCount > 0">
      <span>
        有 {{ recalcCount }} 张定值单引用的短路电流不是当前有效版本，
        冲突时以最近一次整定计算采用的版本为准。
      </span>
      <RouterLink class="link" to="/settingvalue">前往定值整定处理待重算清单 →</RouterLink>
    </div>

    <!-- 取值登记 -->
    <section class="sc-form-card">
      <h3 class="block-title">{{ form.id === 0 ? '登记 / 重新取值' : `重新取值：${form.voltageLevel} · ${form.opMode}` }}</h3>
      <form class="sc-form" @submit.prevent="submit">
        <label class="filter-item">
          <span>电压等级</span>
          <select v-model="form.voltageLevel" :disabled="form.id !== 0">
            <option value="" disabled>请选择</option>
            <option v-for="level in levels" :key="level" :value="level">{{ level }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>运行方式</span>
          <select v-model="form.opMode" :disabled="form.id !== 0">
            <option value="" disabled>请选择</option>
            <option v-for="mode in modes" :key="mode" :value="mode">{{ mode }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>计算方式</span>
          <select v-model="form.calcMethod">
            <option value="" disabled>请选择</option>
            <option v-for="method in methodOptions" :key="method" :value="method">{{ method }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>系统阻抗</span>
          <input v-model="form.systemImpedance" placeholder="如 6.30Ω 或 0.1750（标幺）" />
        </label>
        <label class="filter-item">
          <span>三相短路电流 (kA)</span>
          <input v-model="form.shortCircuitCurrent" placeholder="如 21.10" />
        </label>
        <label class="filter-item">
          <span>参数来源</span>
          <input v-model="form.source" placeholder="运行方式下达单 / 整定计算书" />
        </label>
        <label class="filter-item">
          <span>取值日期</span>
          <input v-model="form.valuedAt" type="date" />
        </label>
        <div class="sc-form-actions">
          <button class="btn primary" type="submit">提交取值</button>
          <button v-if="form.id !== 0" class="btn ghost" type="button" @click="resetForm">取消</button>
        </div>
      </form>
      <p v-if="message" class="form-message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</p>
    </section>

    <!-- 按电压等级分栏 -->
    <h3 class="block-title">参数分栏（同一电压等级 + 运行方式仅保留最新一版有效参数）</h3>
    <div class="sc-board">
      <section v-for="card in valuedCards" :key="card.voltageLevel" class="sc-column">
        <header class="sc-col-head">
          <strong>{{ card.voltageLevel }}</strong>
          <span v-if="card.newerThanAdopted" class="tag tag-alert">整定待重算</span>
          <span v-else-if="!card.adopted" class="tag tag-warn">未整定采用</span>
          <span v-else class="tag tag-ok">整定已采用</span>
        </header>

        <article v-for="mode in card.modes" :key="mode.opMode" class="sc-mode-card">
          <div class="sc-mode-head">
            <span class="mode-name">{{ mode.opMode }}</span>
            <span v-if="mode.version && mode.adopted" class="tag tag-ok">最近整定采用</span>
          </div>
          <template v-if="mode.version">
            <dl class="sc-dl">
              <div><dt>计算方式</dt><dd>{{ mode.version.calcMethod }}</dd></div>
              <div><dt>系统阻抗</dt><dd>{{ mode.version.systemImpedance }}</dd></div>
              <div>
                <dt>三相短路电流</dt>
                <dd class="current-value">{{ mode.version.shortCircuitCurrent }} kA</dd>
              </div>
              <div><dt>参数来源</dt><dd>{{ mode.version.source }}</dd></div>
              <div><dt>取值日期</dt><dd>{{ mode.version.valuedAt }}</dd></div>
              <div><dt>入库时间</dt><dd>{{ mode.version.submittedAt }}</dd></div>
            </dl>
            <button class="link" type="button" @click="prefill(mode.version)">重新取值</button>
          </template>
          <p v-else class="sc-empty-mode">该运行方式尚未取值</p>
        </article>

        <p v-if="card.adopted && card.newerThanAdopted" class="sc-conflict">
          当前有效 #{{ card.primary?.id }}：{{ card.primary?.shortCircuitCurrent }}kA；
          最近整定（{{ card.adoptedInfo?.settingNo }}）仍采用 #{{ card.adopted?.id }}：
          {{ card.adopted?.shortCircuitCurrent }}kA
        </p>
      </section>

      <!-- 还没取值的电压等级单独一栏 -->
      <section class="sc-column sc-column-pending">
        <header class="sc-col-head">
          <strong>待取值</strong>
          <span class="tag tag-warn">{{ pendingLevels.length }} 个等级</span>
        </header>
        <article v-for="level in pendingLevels" :key="level" class="sc-mode-card">
          <div class="sc-mode-head">
            <span class="mode-name">{{ level }}</span>
          </div>
          <p class="sc-empty-mode">台账与整定单引用过该等级，但参数库尚未登记系统阻抗与短路电流</p>
          <button class="link" type="button" @click="prefillEmpty(level)">补充取值</button>
        </article>
        <p v-if="!pendingLevels.length" class="sc-empty-mode">所有电压等级均已取值</p>
      </section>
    </div>

    <!-- 历史台账 -->
    <h3 class="block-title">版本台账（已失效旧版留痕，不再参与整定计算）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>版本</th><th>电压等级</th><th>运行方式</th><th>计算方式</th>
          <th>系统阻抗</th><th>三相短路电流</th><th>参数来源</th><th>取值日期</th>
          <th>入库时间</th><th>状态</th><th>替代版本</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in history" :key="v.id" :class="{ 'row-dead': v.status === '已失效' }">
          <td>#{{ v.id }}</td>
          <td>{{ v.voltageLevel }}</td>
          <td>{{ v.opMode }}</td>
          <td>{{ v.calcMethod }}</td>
          <td>{{ v.systemImpedance }}</td>
          <td>{{ v.shortCircuitCurrent }} kA</td>
          <td>{{ v.source }}</td>
          <td>{{ v.valuedAt }}</td>
          <td>{{ v.submittedAt }}</td>
          <td>
            <span :class="v.status === '有效' ? 'tag tag-ok' : 'tag tag-dead'">{{ v.status }}</span>
          </td>
          <td>{{ v.supersededById ? `#${v.supersededById}` : '—' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  calcMethods,
  historyVersions,
  levelCards,
  libraryLevels,
  opModes,
  pendingRecalcCount,
  resetLibrary as resetLibraryData,
  submitVersion,
} from '@/api/sc-service'
import { scState } from '@/data/sc-store'
import type { ScVersion, ScVersionInput } from '@/data/sc-types'

const levels = libraryLevels()
const modes = opModes()
const methodOptions = calcMethods()

const cards = ref(levelCards(scState()))
const history = ref(historyVersions(scState()))
const recalcCount = ref(pendingRecalcCount())

const today = new Date().toISOString().slice(0, 10)
const emptyForm = (): ScVersionInput & { id: number } => ({
  id: 0,
  voltageLevel: '',
  opMode: '最大运行方式',
  calcMethod: '',
  systemImpedance: '',
  shortCircuitCurrent: '',
  source: '',
  valuedAt: today,
})
const form = reactive(emptyForm())
const message = ref('')
const messageOk = ref(false)

const valuedCards = computed(() => cards.value.filter((card) => card.hasValues))
const pendingLevels = computed(() =>
  cards.value.filter((card) => !card.hasValues).map((card) => card.voltageLevel),
)
const valuedCount = computed(() => valuedCards.value.length)
const activeCount = computed(
  () => history.value.filter((v) => v.status === '有效').length,
)

function reload() {
  cards.value = levelCards(scState())
  history.value = historyVersions(scState())
  recalcCount.value = pendingRecalcCount()
}

function prefill(version: ScVersion) {
  Object.assign(form, {
    id: version.id,
    voltageLevel: version.voltageLevel,
    opMode: version.opMode,
    calcMethod: version.calcMethod,
    systemImpedance: '',
    shortCircuitCurrent: '',
    source: version.source,
    valuedAt: today,
  })
  message.value = ''
}

function prefillEmpty(level: string) {
  Object.assign(form, emptyForm(), { voltageLevel: level })
  message.value = ''
}

function resetForm() {
  Object.assign(form, emptyForm())
  message.value = ''
}

function submit() {
  const result = submitVersion({
    voltageLevel: form.voltageLevel,
    opMode: form.opMode,
    calcMethod: form.calcMethod,
    systemImpedance: form.systemImpedance,
    shortCircuitCurrent: form.shortCircuitCurrent,
    source: form.source,
    valuedAt: form.valuedAt,
  })
  messageOk.value = result.ok
  message.value = result.message
  if (result.ok) {
    resetForm()
    reload()
  }
}

function resetLibrary() {
  resetLibraryData()
  reload()
  message.value = '参数库已恢复为示例数据'
  messageOk.value = true
}

onMounted(reload)
</script>

<style scoped>
.block-title { font-size: 15px; margin: 18px 0 10px; }
.stat-alert { color: #b42318; }
.sc-banner {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  background: #fef3f2; border: 1px solid #fda29b; border-radius: 8px;
  padding: 8px 12px; font-size: 13px; color: #b42318; margin-bottom: 12px;
}
.sc-form-card {
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  padding: 12px 14px; margin-bottom: 16px;
}
.sc-form { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.sc-form .filter-item { min-width: 170px; }
.sc-form .filter-item input,
.sc-form .filter-item select { width: 100%; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
.sc-form-actions { display: flex; gap: 8px; }
.form-message { margin: 8px 0 0; font-size: 12px; }
.ok-text { color: #067647; }
.sc-board { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; align-items: start; }
.sc-column {
  background: #f1f5f9; border: 1px solid var(--border); border-radius: 8px;
  padding: 10px; display: flex; flex-direction: column; gap: 10px;
}
.sc-column-pending { background: #fffbeb; border-color: #f5c96b; }
.sc-col-head { display: flex; justify-content: space-between; align-items: center; }
.sc-mode-card {
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  padding: 10px; display: flex; flex-direction: column; gap: 6px;
}
.sc-mode-head { display: flex; justify-content: space-between; align-items: center; }
.mode-name { font-weight: 600; font-size: 13px; }
.sc-dl { margin: 0; display: flex; flex-direction: column; gap: 4px; }
.sc-dl div { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.sc-dl dt { color: var(--muted); white-space: nowrap; }
.sc-dl dd { margin: 0; text-align: right; word-break: break-all; }
.current-value { font-weight: 700; color: #1f6feb; }
.sc-empty-mode { margin: 0; font-size: 12px; color: var(--muted); }
.sc-conflict { margin: 0; font-size: 12px; color: #b42318; background: #fef3f2; border-radius: 6px; padding: 6px 8px; }
.tag { font-size: 11px; border-radius: 999px; padding: 1px 8px; white-space: nowrap; }
.tag-ok { background: #dcfae6; color: #067647; }
.tag-warn { background: #fef0c7; color: #b54708; }
.tag-alert { background: #fee4e2; color: #b42318; }
.tag-dead { background: #e5e7eb; color: #6b7280; }
.row-dead { color: #9ca3af; }
</style>
