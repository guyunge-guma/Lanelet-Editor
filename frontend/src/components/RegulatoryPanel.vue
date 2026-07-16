<template>
  <div class="regulatory-panel">
    <!-- 创建 Regulatory Element -->
    <div class="section-title">创建 Regulatory Element</div>

    <!-- 类型选择 -->
    <div class="form-row">
      <label>类型</label>
      <el-select v-model="newType" size="small" @change="onTypeChange">
        <el-option
          v-for="t in TYPE_OPTIONS"
          :key="t.value"
          :label="t.label"
          :value="t.value"
        />
      </el-select>
    </div>

    <!-- 关联 Lanelet(多选) -->
    <div class="form-row align-top">
      <label>关联车道</label>
      <el-select
        v-model="newLaneletIds"
        size="small"
        multiple
        collapse-tags
        collapse-tags-tooltip
        filterable
        placeholder="选择关联 Lanelet"
        :disabled="!lanelets.length"
      >
        <el-option
          v-for="ll in lanelets"
          :key="ll.id"
          :label="`#${ll.id}`"
          :value="ll.id"
        />
      </el-select>
    </div>

    <!-- 预设属性(按类型) -->
    <template v-if="presetAttrs.length">
      <div class="section-subtitle">预设属性</div>
      <div v-for="p in presetAttrs" :key="p.key" class="form-row">
        <label>{{ p.label }}</label>
        <el-select v-if="p.options" v-model="presetValues[p.key]" size="small">
          <el-option
            v-for="opt in p.options"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <el-input v-else v-model="presetValues[p.key]" size="small" :placeholder="p.placeholder" />
      </div>
    </template>

    <!-- 自定义属性(动态 key-value) -->
    <div class="section-subtitle">自定义属性</div>
    <div v-for="(item, idx) in customAttrs" :key="idx" class="attr-row">
      <el-input v-model="item.key" size="small" placeholder="属性名" class="attr-key" />
      <el-input v-model="item.value" size="small" placeholder="属性值" class="attr-val" />
      <el-button size="small" link type="danger" @click="removeCustomAttr(idx)">删</el-button>
    </div>
    <el-button size="small" link type="primary" @click="addCustomAttr">+ 添加属性</el-button>

    <el-button
      type="primary"
      size="small"
      class="create-btn"
      :disabled="!canCreate"
      :loading="creating"
      @click="handleCreate"
    >
      创建 {{ typeLabel(newType) }}
    </el-button>

    <el-divider />

    <!-- RE 列表(按类型分组) -->
    <div class="list-header">
      <span>RE 列表 ({{ elements.length }})</span>
      <div class="list-actions">
        <el-button size="small" link @click="loadElements" :loading="loadingList">刷新</el-button>
        <el-button v-if="elements.length" size="small" link type="danger" @click="handleClearAll">
          清空全部
        </el-button>
      </div>
    </div>

    <el-collapse v-model="activeGroups" class="re-collapse">
      <el-collapse-item
        v-for="t in TYPE_OPTIONS"
        :key="t.value"
        :name="t.value"
      >
        <template #title>
          <span class="group-title">
            <span class="color-swatch" :style="{ background: colorCss(t.value) }" />
            {{ t.label }}
            <span class="group-count">({{ grouped(t.value).length }})</span>
          </span>
        </template>
        <div
          v-for="re in grouped(t.value)"
          :key="re.id"
          class="re-item"
          :class="{ active: re.id === selectedId }"
          @click="selectElement(re.id)"
        >
          <span class="color-swatch" :style="{ background: colorCss(t.value) }" />
          <div class="re-info">
            <div class="re-title">
              #{{ re.id }}
              <span class="re-attr" v-if="re.attrs?.sign_type">[{{ re.attrs.sign_type }}]</span>
              <span class="re-attr" v-else-if="re.attrs?.state">[{{ re.attrs.state }}]</span>
            </div>
            <div class="re-meta">车道:{{ re.lanelet_ids.length ? re.lanelet_ids.map(i => '#' + i).join(', ') : '无' }}</div>
          </div>
          <el-button size="small" link type="danger" @click.stop="handleDelete(re)">删除</el-button>
        </div>
        <el-empty v-if="!grouped(t.value).length" description="无" :image-size="32" />
      </el-collapse-item>
    </el-collapse>

    <!-- 选中 RE 的详情 -->
    <template v-if="selectedElement">
      <el-divider />
      <div class="section-title">详情 (#{{ selectedElement.id }})</div>
      <div class="detail-row"><span>类型:</span><span>{{ typeLabel(selectedElement.type) }}</span></div>
      <div class="detail-row"><span>关联车道:</span><span>{{ selectedElement.lanelet_ids.map(i => '#' + i).join(', ') || '无' }}</span></div>
      <div class="detail-row" v-for="(v, k) in selectedElement.attrs" :key="k">
        <span>{{ k }}:</span><span>{{ v }}</span>
      </div>
    </template>

    <el-divider />

    <!-- 颜色图例 -->
    <div class="legend">
      <div class="legend-title">类型图例</div>
      <div v-for="t in TYPE_OPTIONS" :key="t.value" class="legend-item">
        <span class="color-swatch" :style="{ background: colorCss(t.value) }" />
        <span>{{ t.label }} ({{ t.value }})</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, watch, onBeforeUnmount, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  DrawingManager,
  REGULATORY_TYPE_COLORS,
  REGULATORY_TYPE_LABELS,
} from '../utils/DrawingManager'
import {
  createRegulatoryElement,
  listRegulatoryElements,
  deleteRegulatoryElement,
  listLanelets,
  type RegulatoryElement,
} from '../api'

/** RE 类型选项 */
const TYPE_OPTIONS = [
  { value: 'traffic_light', label: '红绿灯' },
  { value: 'stop_line', label: '停止线' },
  { value: 'crosswalk', label: '斑马线' },
  { value: 'traffic_sign', label: '交通标志' },
] as const

/** 预设属性定义(按类型) */
interface PresetAttr {
  key: string
  label: string
  placeholder?: string
  options?: { value: string; label: string }[]
}

const PRESET_ATTRS: Record<string, PresetAttr[]> = {
  traffic_light: [
    {
      key: 'state',
      label: '状态',
      options: [
        { value: 'red', label: '红灯' },
        { value: 'yellow', label: '黄灯' },
        { value: 'green', label: '绿灯' },
      ],
    },
  ],
  traffic_sign: [
    {
      key: 'sign_type',
      label: '标志类型',
      placeholder: '如:stop / yield / speed_limit',
    },
    {
      key: 'value',
      label: '数值',
      placeholder: '如:60(限速值)',
    },
  ],
  stop_line: [],
  crosswalk: [],
}

interface LaneletOption {
  id: number
}

interface CustomAttr {
  key: string
  value: string
}

const emit = defineEmits<{
  (e: 'regulatory-created', id: number): void
  (e: 'regulatory-deleted', id: number): void
}>()

const drawingManagerRef = inject<Ref<DrawingManager | null>>('drawingManager', ref(null))
const drawingManager = computed(() => drawingManagerRef.value)

// 创建表单
const newType = ref<string>('traffic_light')
const newLaneletIds = ref<number[]>([])
const presetValues = ref<Record<string, string>>({})
const customAttrs = ref<CustomAttr[]>([])
const creating = ref(false)

// 列表
const elements = ref<RegulatoryElement[]>([])
const lanelets = ref<LaneletOption[]>([])
const loadingList = ref(false)
const selectedId = ref<number | null>(null)
const activeGroups = ref<string[]>(['traffic_light', 'stop_line', 'crosswalk', 'traffic_sign'])

const presetAttrs = computed(() => PRESET_ATTRS[newType.value] ?? [])

const canCreate = computed(() => newType.value !== '' && newLaneletIds.value.length > 0)

const selectedElement = computed(() =>
  elements.value.find(e => e.id === selectedId.value) ?? null,
)

/** 类型变化时重置预设属性 */
function onTypeChange(type: string): void {
  presetValues.value = {}
  const presets = PRESET_ATTRS[type] ?? []
  for (const p of presets) {
    presetValues.value[p.key] = p.options ? p.options[0].value : ''
  }
}

function addCustomAttr(): void {
  customAttrs.value.push({ key: '', value: '' })
}

function removeCustomAttr(idx: number): void {
  customAttrs.value.splice(idx, 1)
}

// ---------------- 创建 ----------------

async function handleCreate(): Promise<void> {
  if (!canCreate.value) {
    ElMessage.warning('请选择类型并至少关联一个 Lanelet')
    return
  }
  creating.value = true
  try {
    // 合并预设 + 自定义属性
    const attrs: Record<string, string> = {}
    for (const [k, v] of Object.entries(presetValues.value)) {
      if (v !== '' && v !== null && v !== undefined) {
        attrs[k] = String(v)
      }
    }
    for (const item of customAttrs.value) {
      if (item.key.trim() !== '') {
        attrs[item.key.trim()] = item.value
      }
    }

    const res = await createRegulatoryElement(newType.value, newLaneletIds.value, attrs)
    const id: number = res?.id
    if (id === undefined || id === null) {
      ElMessage.warning('创建 RE 成功,但未返回 id')
      return
    }
    elements.value.push({
      id,
      type: newType.value,
      lanelet_ids: [...newLaneletIds.value],
      attrs,
    })
    ElMessage.success(`${typeLabel(newType.value)} #${id} 已创建`)
    emit('regulatory-created', id)
    selectElement(id)

    // 重置表单(保留类型与车道选择,方便连续创建)
    presetValues.value = {}
    onTypeChange(newType.value)
    customAttrs.value = []
  } catch (e: any) {
    console.error('[RegulatoryPanel] 创建 RE 失败:', e)
    ElMessage.error('创建 RE 失败: ' + (e?.response?.data?.detail || e?.message || ''))
  } finally {
    creating.value = false
  }
}

// ---------------- 加载 ----------------

async function loadElements(): Promise<void> {
  loadingList.value = true
  try {
    const items = await listRegulatoryElements()
    elements.value = items
    ElMessage.success(`已加载 ${items.length} 个 Regulatory Element`)
  } catch (e) {
    console.warn('[RegulatoryPanel] 加载 RE 列表失败:', e)
    ElMessage.warning('加载 RE 列表失败(后端可能未就绪)')
  } finally {
    loadingList.value = false
  }
}

async function loadLanelets(): Promise<void> {
  try {
    const items = await listLanelets()
    lanelets.value = (items as any[]).map(it => ({ id: it.id }))
  } catch {
    // 后端可能未就绪
  }
}

// ---------------- 选择 / 高亮 ----------------

/** 选中 RE:高亮关联的 Lanelet */
function selectElement(id: number): void {
  // 取消旧高亮
  clearHighlight()
  selectedId.value = id
  // 高亮关联 Lanelet(若已可视化)
  const re = selectedElement.value
  if (re && drawingManager.value) {
    for (const llId of re.lanelet_ids) {
      if (drawingManager.value.hasLaneletMesh(llId)) {
        drawingManager.value.highlightLanelet(llId, true)
      }
    }
  }
}

function clearHighlight(): void {
  const re = selectedElement.value
  if (re && drawingManager.value) {
    for (const llId of re.lanelet_ids) {
      if (drawingManager.value.hasLaneletMesh(llId)) {
        drawingManager.value.highlightLanelet(llId, false)
      }
    }
  }
}

// ---------------- 删除 ----------------

async function handleDelete(re: RegulatoryElement): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认删除 ${typeLabel(re.type)} #${re.id}?此操作不可恢复`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }

  try {
    await deleteRegulatoryElement(re.id)
  } catch (e) {
    console.warn('[RegulatoryPanel] 后端删除 RE 失败:', e)
    ElMessage.warning('后端删除失败,仅从前端移除')
  }

  if (selectedId.value === re.id) {
    clearHighlight()
    selectedId.value = null
  }
  elements.value = elements.value.filter(e => e.id !== re.id)
  emit('regulatory-deleted', re.id)
  ElMessage.success(`${typeLabel(re.type)} #${re.id} 已删除`)
}

async function handleClearAll(): Promise<void> {
  try {
    await ElMessageBox.confirm('确认清空所有 Regulatory Element?此操作不可恢复', '清空确认', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  const ids = elements.value.map(e => e.id)
  for (const id of ids) {
    try {
      await deleteRegulatoryElement(id)
    } catch {
      // 忽略单个删除失败
    }
    emit('regulatory-deleted', id)
  }
  elements.value = []
  clearHighlight()
  selectedId.value = null
  ElMessage.success('已清空所有 Regulatory Element')
}

// ---------------- 工具函数 ----------------

function grouped(type: string): RegulatoryElement[] {
  return elements.value.filter(e => e.type === type)
}

function colorCss(type: string): string {
  const c = REGULATORY_TYPE_COLORS[type] ?? 0x888888
  return '#' + c.toString(16).padStart(6, '0')
}

function typeLabel(type: string): string {
  return REGULATORY_TYPE_LABELS[type] ?? type
}

// ---------------- 生命周期 ----------------

let initialized = false
async function initOnce(): Promise<void> {
  if (initialized) return
  if (!drawingManager.value) return
  initialized = true
  // 初始化预设属性默认值
  onTypeChange(newType.value)
  await Promise.all([loadElements(), loadLanelets()])
}

watch(drawingManagerRef, () => {
  initOnce()
}, { immediate: true })

onBeforeUnmount(() => {
  // 清空高亮
  clearHighlight()
})
</script>

<style scoped>
.regulatory-panel {
  padding: 4px 0;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}

.section-subtitle {
  font-size: 11px;
  font-weight: 500;
  color: #606266;
  margin: 8px 0 6px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.form-row.align-top {
  align-items: flex-start;
}

.form-row label {
  width: 56px;
  font-size: 12px;
  color: #606266;
  flex-shrink: 0;
  padding-top: 2px;
}

.form-row .el-select,
.form-row .el-input {
  flex: 1;
}

.attr-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.attr-key {
  flex: 1;
}

.attr-val {
  flex: 1.4;
}

.create-btn {
  width: 100%;
  margin-top: 8px;
  margin-bottom: 8px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 8px;
}

.list-actions {
  display: flex;
  gap: 4px;
}

.re-collapse {
  border-top: none;
}

.re-collapse :deep(.el-collapse-item__header) {
  font-size: 12px;
  padding-left: 0;
}

.re-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 4px;
}

.group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: #303133;
}

.group-count {
  color: #909399;
  font-weight: normal;
}

.re-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
}

.re-item:hover {
  background: #f5f7fa;
}

.re-item.active {
  background: #ecf5ff;
  border-left: 3px solid #409eff;
  padding-left: 1px;
}

.color-swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.re-info {
  flex: 1;
  min-width: 0;
}

.re-title {
  font-size: 13px;
  color: #303133;
}

.re-attr {
  color: #606266;
  margin-left: 4px;
  font-size: 11px;
}

.re-meta {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  padding: 3px 0;
  color: #303133;
}

.detail-row span:first-child {
  color: #909399;
  flex-shrink: 0;
  margin-right: 8px;
}

.detail-row span:last-child {
  text-align: right;
  word-break: break-all;
}

.legend {
  font-size: 12px;
}

.legend-title {
  font-weight: 500;
  color: #303133;
  margin-bottom: 6px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  color: #606266;
}
</style>
