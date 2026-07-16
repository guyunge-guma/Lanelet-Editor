<template>
  <div class="lanelet-panel">
    <!-- 创建 Lanelet -->
    <div class="section-title">创建 Lanelet</div>
    <div class="form-row">
      <label>左边界</label>
      <el-select
        v-model="leftBoundId"
        size="small"
        placeholder="选择左边界"
        filterable
        :disabled="!linestrings.length"
      >
        <el-option
          v-for="ls in linestrings"
          :key="ls.id"
          :label="`#${ls.id} (${typeLabel(ls.type)}${ls.subtype ? ' / ' + lineSubtypeLabel(ls.type, ls.subtype) : ''}, ${ls.pointCount}点)`"
          :value="ls.id"
          :disabled="ls.id === rightBoundId"
        />
      </el-select>
    </div>
    <div class="form-row">
      <label>右边界</label>
      <el-select
        v-model="rightBoundId"
        size="small"
        placeholder="选择右边界"
        filterable
        :disabled="!linestrings.length"
      >
        <el-option
          v-for="ls in linestrings"
          :key="ls.id"
          :label="`#${ls.id} (${typeLabel(ls.type)}${ls.subtype ? ' / ' + lineSubtypeLabel(ls.type, ls.subtype) : ''}, ${ls.pointCount}点)`"
          :value="ls.id"
          :disabled="ls.id === leftBoundId"
        />
      </el-select>
    </div>
    <div class="form-row">
      <label>子类型</label>
      <el-select v-model="newSubtype" size="small">
        <el-option
          v-for="s in SUBTYPE_OPTIONS"
          :key="s.value"
          :label="s.label"
          :value="s.value"
        />
      </el-select>
    </div>
    <div class="form-row">
      <label>方向</label>
      <el-select v-model="newDirection" size="small">
        <el-option label="正向 (左→右)" value="forward" />
        <el-option label="反向 (右→左)" value="backward" />
      </el-select>
    </div>
    <el-button
      type="primary"
      size="small"
      class="create-btn"
      :disabled="!canCreate"
      :loading="creating"
      @click="handleCreate"
    >
      创建 Lanelet
    </el-button>
    <div v-if="!linestrings.length" class="hint">
      暂无可用 LineString,请先在 LineString 标签下绘制边界
    </div>

    <el-divider />

    <!-- Lanelet 列表 -->
    <div class="list-header">
      <span>Lanelet 列表 ({{ lanelets.length }})</span>
      <div class="list-actions">
        <el-button size="small" link @click="loadLanelets" :loading="loadingList">刷新</el-button>
        <el-button v-if="lanelets.length" size="small" link type="danger" @click="handleClearAll">
          清空全部
        </el-button>
      </div>
    </div>
    <div class="lanelet-list">
      <div
        v-for="ll in lanelets"
        :key="ll.id"
        class="lanelet-item"
        :class="{ active: ll.id === selectedLaneletId }"
        @click="selectLanelet(ll.id)"
      >
        <span class="color-swatch" :style="{ background: colorCss(subtypeOf(ll)) }" />
        <div class="lanelet-info">
          <div class="lanelet-title">
            #{{ ll.id }}
            <span class="ll-subtype">{{ subtypeLabel(subtypeOf(ll)) }}</span>
          </div>
          <div class="lanelet-meta">
            左:{{ ll.left_id }} / 右:{{ ll.right_id }}
            <span v-if="!hasGeometry(ll)" class="no-geo">(无几何)</span>
          </div>
        </div>
        <el-button size="small" link type="danger" @click.stop="handleDelete(ll)">
          删除
        </el-button>
      </div>
      <el-empty v-if="!lanelets.length" description="暂无 Lanelet" :image-size="40" />
    </div>

    <!-- 属性 / 拓扑编辑 -->
    <template v-if="selectedLanelet">
      <el-divider />
      <div class="section-title">属性编辑 (#{{ selectedLanelet.id }})</div>
      <div class="form-row">
        <label>子类型</label>
        <el-select v-model="editSubtype" size="small" @change="handleSubtypeChange">
          <el-option
            v-for="s in SUBTYPE_OPTIONS"
            :key="s.value"
            :label="s.label"
            :value="s.value"
          />
        </el-select>
      </div>

      <div class="section-title" style="margin-top:10px">拓扑关系</div>
      <div class="form-row align-top">
        <label>前驱</label>
        <el-select
          v-model="editPredecessor"
          size="small"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="选择前驱 Lanelet"
          @change="handleRelationsChange"
        >
          <el-option
            v-for="ll in otherLanelets"
            :key="ll.id"
            :label="`#${ll.id}`"
            :value="ll.id"
          />
        </el-select>
      </div>
      <div class="form-row align-top">
        <label>后继</label>
        <el-select
          v-model="editSuccessor"
          size="small"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="选择后继 Lanelet"
          @change="handleRelationsChange"
        >
          <el-option
            v-for="ll in otherLanelets"
            :key="ll.id"
            :label="`#${ll.id}`"
            :value="ll.id"
          />
        </el-select>
      </div>
      <div class="tip">拓扑关系保存到后端;若后端暂不支持,仅保留在前端</div>
    </template>

    <el-divider />

    <!-- 颜色图例 -->
    <div class="legend">
      <div class="legend-title">颜色图例</div>
      <div v-for="s in SUBTYPE_OPTIONS" :key="s.value" class="legend-item">
        <span class="color-swatch" :style="{ background: colorCss(s.value) }" />
        <span>{{ s.label }} ({{ s.value }})</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  DrawingManager,
  LANELET_SUBTYPE_COLORS,
  LANELET_SUBTYPE_LABELS,
  TYPE_LABELS,
  lineSubtypeLabel,
} from '../utils/DrawingManager'
import {
  createLanelet,
  deleteLanelet,
  getLaneletGeometry,
  listLanelets,
  updateLanelet,
  setLaneletRelations,
  getLaneletRelations,
  getLinestring,
} from '../api'

/** Lanelet 子类型选项 */
const SUBTYPE_OPTIONS = [
  { value: 'road', label: '道路' },
  { value: 'urban', label: '城市' },
  { value: 'intersection', label: '交叉口' },
  { value: 'speed_bump', label: '减速带' },
] as const

/** 可选 LineString 项 */
interface LineStringOption {
  id: number
  type: string
  subtype: string
  pointCount: number
}

/** Lanelet 内部记录(同时持有 id / 左右边界 id / 坐标,用于列表显示与可视化) */
interface LaneletEntry {
  id: number
  left_id: number
  right_id: number
  attrs: Record<string, string>
  left_coords: number[]
  right_coords: number[]
}

const props = defineProps<{
  /** 可选的左右边界 LineString 列表 */
  linestrings?: LineStringOption[]
}>()

const emit = defineEmits<{
  (e: 'lanelet-created', id: number): void
  (e: 'lanelet-deleted', id: number): void
  (e: 'lanelet-selected', id: number | null): void
}>()

// 通过 inject 获取 MapView 提供的 DrawingManager(响应式 ref)
const drawingManagerRef = inject<Ref<DrawingManager | null>>('drawingManager', ref(null))
const drawingManager = computed(() => drawingManagerRef.value)
// viewer 通过 inject 获取(预留,可视化统一走 DrawingManager)
const viewerRef = inject<Ref<any> | null>('viewer', null)
// 显式引用以避免未使用告警
void viewerRef

const linestrings = computed(() => props.linestrings ?? [])

// 创建表单
const leftBoundId = ref<number | null>(null)
const rightBoundId = ref<number | null>(null)
const newSubtype = ref<string>('road')
const newDirection = ref<'forward' | 'backward'>('forward')
const creating = ref(false)
const loadingList = ref(false)

// Lanelet 列表
const lanelets = ref<LaneletEntry[]>([])
const selectedLaneletId = ref<number | null>(null)

// 属性 / 拓扑编辑
const editSubtype = ref<string>('road')
const editPredecessor = ref<number[]>([])
const editSuccessor = ref<number[]>([])

const canCreate = computed(
  () =>
    leftBoundId.value !== null &&
    rightBoundId.value !== null &&
    leftBoundId.value !== rightBoundId.value,
)

const selectedLanelet = computed(() =>
  lanelets.value.find(l => l.id === selectedLaneletId.value) ?? null,
)

/** 除当前选中 Lanelet 之外的其他 Lanelet(用于拓扑关系选择) */
const otherLanelets = computed(() =>
  lanelets.value.filter(l => l.id !== selectedLaneletId.value),
)

/** 提取 Lanelet 的 subtype(默认 road) */
function subtypeOf(entry: LaneletEntry): string {
  return entry.attrs?.subtype || 'road'
}

/** 是否已具备几何坐标(用于可视化) */
function hasGeometry(entry: LaneletEntry): boolean {
  return entry.left_coords.length >= 6 && entry.right_coords.length >= 6
}

// ---------------- 可视化 ----------------

/** 为单条 Lanelet 添加面片 + 方向箭头 */
function addMeshForEntry(entry: LaneletEntry): void {
  if (!hasGeometry(entry)) return
  const dm = drawingManager.value
  if (!dm) return
  const color = LANELET_SUBTYPE_COLORS[subtypeOf(entry)] ?? 0x888888
  dm.addLaneletMesh(entry.id, entry.left_coords, entry.right_coords, color, 'forward')
}

/** 重新构建某 Lanelet 的可视化(先移除再添加,用于颜色更新) */
function rebuildMeshForEntry(entry: LaneletEntry): void {
  drawingManager.value?.removeLaneletMesh(entry.id)
  addMeshForEntry(entry)
  // 若当前为选中态,恢复高亮
  if (entry.id === selectedLaneletId.value) {
    drawingManager.value?.highlightLanelet(entry.id, true)
  }
}

/** 取消所有高亮 */
function clearHighlight(): void {
  if (selectedLaneletId.value !== null) {
    drawingManager.value?.highlightLanelet(selectedLaneletId.value, false)
  }
}

// ---------------- 加载 ----------------

/** 从后端加载 Lanelet 列表并可视化 */
async function loadLanelets(): Promise<void> {
  loadingList.value = true
  try {
    const items = await listLanelets()
    // 清空旧可视化
    drawingManager.value?.clearAllLaneletMeshes()
    lanelets.value = []
    selectedLaneletId.value = null
    emit('lanelet-selected', null)

    const entries: LaneletEntry[] = []
    for (const item of items as any[]) {
      const id: number = item.id
      const leftId: number = item.left_id
      const rightId: number = item.right_id
      // 后端可能返回 attrs 或 attributes,统一兼容
      const attrs: Record<string, string> = item.attrs ?? item.attributes ?? {}

      // 拉取几何坐标(若后端暂不支持则跳过可视化)
      let leftCoords: number[] = []
      let rightCoords: number[] = []
      try {
        const g = await getLaneletGeometry(id)
        leftCoords = g.left_coords ?? []
        rightCoords = g.right_coords ?? []
      } catch {
        // 几何接口暂不可用,仅保留列表项
      }

      const entry: LaneletEntry = {
        id,
        left_id: leftId,
        right_id: rightId,
        attrs,
        left_coords: leftCoords,
        right_coords: rightCoords,
      }
      entries.push(entry)
      addMeshForEntry(entry)
    }
    lanelets.value = entries
    ElMessage.success(`已加载 ${entries.length} 个 Lanelet`)
  } catch (e) {
    console.warn('[LaneletPanel] 加载 Lanelet 列表失败:', e)
    ElMessage.warning('加载 Lanelet 列表失败(后端可能未就绪)')
  } finally {
    loadingList.value = false
  }
}

// ---------------- 创建 ----------------

async function handleCreate(): Promise<void> {
  if (!canCreate.value) return
  const leftId = leftBoundId.value as number
  const rightId = rightBoundId.value as number
  creating.value = true
  try {
    // 碰撞检测:先拉取左右边界坐标,检查与已有 Lanelet 是否重叠
    let leftCoords: number[] = []
    let rightCoords: number[] = []
    try {
      const lg = await getLinestring(leftId)
      leftCoords = lg.coords ?? []
      const rg = await getLinestring(rightId)
      rightCoords = rg.coords ?? []
    } catch {
      // 几何接口不可用,跳过碰撞检测
    }

    if (leftCoords.length > 0 && rightCoords.length > 0) {
      const overlaps = drawingManager.value?.checkLaneletOverlap(leftCoords, rightCoords) ?? []
      if (overlaps.length > 0) {
        const ids = overlaps.map(id => `#${id}`).join(', ')
        try {
          await ElMessageBox.confirm(
            `新建区域与已有 Lanelet (${ids}) 存在重叠,是否继续创建?`,
            '区域碰撞警告',
            { confirmButtonText: '继续创建', cancelButtonText: '取消', type: 'warning' },
          )
        } catch {
          // 用户取消
          return
        }
      }
    }

    const res = await createLanelet(leftId, rightId, { subtype: newSubtype.value })
    const id: number = res?.id
    if (id === undefined || id === null) {
      ElMessage.warning('创建 Lanelet 成功,但未返回 id')
      return
    }

    // 拉取几何坐标用于可视化
    try {
      const g = await getLaneletGeometry(id)
      leftCoords = g.left_coords ?? []
      rightCoords = g.right_coords ?? []
    } catch {
      // 几何接口暂不可用
    }

    const entry: LaneletEntry = {
      id,
      left_id: leftId,
      right_id: rightId,
      attrs: { subtype: newSubtype.value, direction: newDirection.value },
      left_coords: leftCoords,
      right_coords: rightCoords,
    }
    lanelets.value.push(entry)
    addMeshForEntry(entry)

    // 应用用户设置的方向
    if (newDirection.value === 'backward') {
      drawingManager.value?.setLaneletDirection(id, 'backward')
    }

    ElMessage.success(`Lanelet #${id} 已创建`)
    emit('lanelet-created', id)
    // 自动选中新建的 Lanelet
    selectLanelet(id)
  } catch (e: any) {
    console.error('[LaneletPanel] 创建 Lanelet 失败:', e)
    ElMessage.error('创建 Lanelet 失败: ' + (e?.response?.data?.detail || e?.message || ''))
  } finally {
    creating.value = false
  }
}

// ---------------- 选择 / 高亮 ----------------

async function selectLanelet(id: number): Promise<void> {
  // 取消旧高亮
  clearHighlight()
  selectedLaneletId.value = id
  drawingManager.value?.highlightLanelet(id, true)
  emit('lanelet-selected', id)

  // 同步属性编辑区
  const entry = lanelets.value.find(l => l.id === id)
  if (entry) {
    editSubtype.value = subtypeOf(entry)
  }

  // 加载拓扑关系
  editPredecessor.value = []
  editSuccessor.value = []
  try {
    const rel = await getLaneletRelations(id)
    editPredecessor.value = rel.predecessor ?? []
    editSuccessor.value = rel.successor ?? []
  } catch {
    // 拓扑接口暂不可用,保持空
  }
}

function clearSelection(): void {
  clearHighlight()
  selectedLaneletId.value = null
  emit('lanelet-selected', null)
}

// ---------------- 删除 ----------------

async function handleDelete(entry: LaneletEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认删除 Lanelet #${entry.id}?此操作不可恢复`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }

  try {
    await deleteLanelet(entry.id)
  } catch (e) {
    // 后端可能不支持删除,前端仍清理
    console.warn('[LaneletPanel] 后端删除 Lanelet 失败:', e)
    ElMessage.warning('后端删除失败,仅从前端移除')
  }

  drawingManager.value?.removeLaneletMesh(entry.id)
  lanelets.value = lanelets.value.filter(l => l.id !== entry.id)
  if (selectedLaneletId.value === entry.id) {
    clearSelection()
  }
  emit('lanelet-deleted', entry.id)
  ElMessage.success(`Lanelet #${entry.id} 已删除`)
}

async function handleClearAll(): Promise<void> {
  try {
    await ElMessageBox.confirm('确认清空所有 Lanelet?此操作不可恢复', '清空确认', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  const ids = lanelets.value.map(l => l.id)
  for (const id of ids) {
    try {
      await deleteLanelet(id)
    } catch {
      // 忽略单个删除失败
    }
    drawingManager.value?.removeLaneletMesh(id)
    emit('lanelet-deleted', id)
  }
  lanelets.value = []
  clearSelection()
  ElMessage.success('已清空所有 Lanelet')
}

// ---------------- 属性编辑 ----------------

async function handleSubtypeChange(val: string): Promise<void> {
  const entry = selectedLanelet.value
  if (!entry) return
  try {
    const res = await updateLanelet(entry.id, { attrs: { ...entry.attrs, subtype: val } })
    // update_lanelet 会删除旧 Lanelet 并创建新的,ID 可能变化
    const newId: number = res?.id ?? entry.id
    if (newId !== entry.id) {
      console.log(`[LaneletPanel] Lanelet ID 变化: #${entry.id} → #${newId}`)
      // 更新可视化中的 ID
      drawingManager.value?.removeLaneletMesh(entry.id)
      entry.id = newId
    }
    entry.attrs = { ...entry.attrs, subtype: val }
    // 颜色变更后重建可视化
    rebuildMeshForEntry(entry)
    ElMessage.success(`Lanelet #${newId} 子类型已更新为 ${subtypeLabel(val)}`)
  } catch (e) {
    // 后端更新失败,仍更新前端可视化
    console.warn('[LaneletPanel] 更新 Lanelet 属性失败:', e)
    ElMessage.warning('后端更新失败,仅保留在前端')
    entry.attrs = { ...entry.attrs, subtype: val }
    rebuildMeshForEntry(entry)
  }
}

// ---------------- 拓扑关系 ----------------

async function handleRelationsChange(): Promise<void> {
  const entry = selectedLanelet.value
  if (!entry) return
  try {
    await setLaneletRelations(entry.id, editPredecessor.value, editSuccessor.value)
    ElMessage.success(`Lanelet #${entry.id} 拓扑关系已保存`)
  } catch (e) {
    console.warn('[LaneletPanel] 保存拓扑关系失败:', e)
    ElMessage.warning('拓扑关系保存失败(后端可能未支持)')
  }
}

// ---------------- 工具函数 ----------------

/** 0xRRGGBB -> css 颜色字符串 */
function colorCss(subtype: string): string {
  const c = LANELET_SUBTYPE_COLORS[subtype] ?? 0x888888
  return '#' + c.toString(16).padStart(6, '0')
}

function subtypeLabel(subtype: string): string {
  return LANELET_SUBTYPE_LABELS[subtype] ?? subtype
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

// ---------------- 生命周期 ----------------

// DrawingManager 就绪后加载已有 Lanelet(只触发一次)
let initialized = false
async function initOnce() {
  if (initialized) return
  if (!drawingManager.value) return
  initialized = true
  await loadLanelets()
}

// 监听 drawingManager 就绪(与 LineStringPanel 同模式)
watch(drawingManagerRef, () => {
  initOnce()
}, { immediate: true })

onMounted(() => {
  initOnce()
})

onBeforeUnmount(() => {
  // 离开面板时清理高亮,但保留可视化(切回标签时仍可见)
  clearHighlight()
})
</script>

<style scoped>
.lanelet-panel {
  padding: 4px 0;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
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
  width: 48px;
  font-size: 12px;
  color: #606266;
  flex-shrink: 0;
  padding-top: 2px;
}

.form-row .el-select {
  flex: 1;
}

.create-btn {
  width: 100%;
  margin-bottom: 8px;
}

.hint {
  color: #909399;
  font-size: 12px;
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

.lanelet-list {
  max-height: 220px;
  overflow-y: auto;
}

.lanelet-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
}

.lanelet-item:hover {
  background: #f5f7fa;
}

.lanelet-item.active {
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

.lanelet-info {
  flex: 1;
  min-width: 0;
}

.lanelet-title {
  font-size: 13px;
  color: #303133;
}

.ll-subtype {
  color: #606266;
  margin-left: 4px;
}

.lanelet-meta {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
}

.no-geo {
  color: #e6a23c;
  margin-left: 4px;
}

.tip {
  font-size: 11px;
  color: #909399;
  line-height: 1.6;
  padding: 4px 0;
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
