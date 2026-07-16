<template>
  <div class="traffic-light-panel">
    <!-- 创建红绿灯 -->
    <div class="section-title">创建红绿灯</div>

    <!-- 位置拾取 -->
    <div class="form-row align-top">
      <label>位置</label>
      <div class="pick-box">
        <template v-if="position">
          <span class="pick-coord">
            ({{ position[0].toFixed(2) }}, {{ position[1].toFixed(2) }}, {{ position[2].toFixed(2) }})
          </span>
          <el-button size="small" link type="primary" @click="startPickPosition" :disabled="!drawingManager || isPicking">
            重新拾取
          </el-button>
        </template>
        <template v-else>
          <el-button
            size="small"
            :type="isPicking ? 'warning' : 'primary'"
            :disabled="!drawingManager"
            @click="startPickPosition"
          >
            {{ isPicking ? '请在 3D 场景中点击...' : '点击拾取位置' }}
          </el-button>
        </template>
      </div>
    </div>

    <!-- 关联 Lanelet -->
    <div class="form-row">
      <label>关联车道</label>
      <el-select
        v-model="laneletId"
        size="small"
        placeholder="选择关联 Lanelet(可选)"
        filterable
        clearable
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

    <!-- 朝向(偏航角) -->
    <div class="form-row">
      <label>朝向</label>
      <el-input-number
        v-model="yawDeg"
        size="small"
        :min="-360"
        :max="360"
        :step="15"
        controls-position="right"
        style="width: 100%"
      />
      <span class="unit">°</span>
    </div>

    <!-- 初始状态 -->
    <div class="form-row">
      <label>状态</label>
      <el-select v-model="state" size="small">
        <el-option label="红灯" value="red" />
        <el-option label="黄灯" value="yellow" />
        <el-option label="绿灯" value="green" />
        <el-option label="未知" value="unknown" />
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
      创建红绿灯
    </el-button>

    <div v-if="!drawingManager" class="hint">Potree 未就绪,无法拾取位置</div>
    <div v-else-if="isPicking" class="hint info">在 3D 场景中左键点击点云放置红绿灯 · Esc 取消</div>

    <el-divider />

    <!-- 红绿灯列表 -->
    <div class="list-header">
      <span>红绿灯列表 ({{ trafficLights.length }})</span>
      <div class="list-actions">
        <el-button size="small" link @click="loadTrafficLights" :loading="loadingList">刷新</el-button>
        <el-button v-if="trafficLights.length" size="small" link type="danger" @click="handleClearAll">
          清空全部
        </el-button>
      </div>
    </div>

    <div class="light-list">
      <div
        v-for="tl in trafficLights"
        :key="tl.id"
        class="light-item"
        :class="{ active: tl.id === selectedId }"
        @click="selectLight(tl.id)"
      >
        <span class="state-dot" :style="{ background: stateColor(tl.attrs?.state) }" />
        <div class="light-info">
          <div class="light-title">
            #{{ tl.id }}
            <span class="light-state">{{ stateLabel(tl.attrs?.state) }}</span>
          </div>
          <div class="light-meta">
            位置:({{ tl.position[0].toFixed(1) }}, {{ tl.position[1].toFixed(1) }}, {{ tl.position[2].toFixed(1) }})
          </div>
          <div class="light-meta" v-if="tl.lanelet_id !== null && tl.lanelet_id !== undefined">
            关联车道:#{{ tl.lanelet_id }}
          </div>
        </div>
        <el-button size="small" link type="danger" @click.stop="handleDelete(tl)">删除</el-button>
      </div>
      <el-empty v-if="!trafficLights.length" description="暂无红绿灯" :image-size="40" />
    </div>

    <!-- 选中红绿灯的状态切换 -->
    <template v-if="selectedLight">
      <el-divider />
      <div class="section-title">状态切换 (#{{ selectedLight.id }})</div>
      <div class="state-row">
        <el-button
          v-for="s in ['red', 'yellow', 'green']"
          :key="s"
          size="small"
          :type="state === s ? 'primary' : 'default'"
          @click="handleStateChange(s)"
        >
          {{ stateLabel(s) }}
        </el-button>
      </div>
    </template>

    <el-divider />

    <!-- 颜色图例 -->
    <div class="legend">
      <div class="legend-title">状态图例</div>
      <div class="legend-item">
        <span class="state-dot" style="background: #ff0000" />
        <span>红灯 (red)</span>
      </div>
      <div class="legend-item">
        <span class="state-dot" style="background: #ffaa00" />
        <span>黄灯 (yellow)</span>
      </div>
      <div class="legend-item">
        <span class="state-dot" style="background: #00cc00" />
        <span>绿灯 (green)</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, watch, onBeforeUnmount, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DrawingManager, TRAFFIC_LIGHT_STATE_COLORS } from '../utils/DrawingManager'
import {
  createTrafficLight,
  listTrafficLights,
  deleteTrafficLight,
  listLanelets,
  type TrafficLight,
} from '../api'

interface LaneletOption {
  id: number
}

const emit = defineEmits<{
  (e: 'traffic-light-created', id: number): void
  (e: 'traffic-light-deleted', id: number): void
}>()

// 通过 inject 获取 MapView 提供的 DrawingManager
const drawingManagerRef = inject<Ref<DrawingManager | null>>('drawingManager', ref(null))
const drawingManager = computed(() => drawingManagerRef.value)

// 创建表单
const position = ref<[number, number, number] | null>(null)
const laneletId = ref<number | null>(null)
const yawDeg = ref(0)
const state = ref<string>('red')
const creating = ref(false)
const isPicking = ref(false)

// 列表
const trafficLights = ref<TrafficLight[]>([])
const lanelets = ref<LaneletOption[]>([])
const loadingList = ref(false)
const selectedId = ref<number | null>(null)

const canCreate = computed(() => position.value !== null && !isPicking.value)

const selectedLight = computed(() =>
  trafficLights.value.find(t => t.id === selectedId.value) ?? null,
)

// ---------------- 位置拾取 ----------------

/** 启动单点拾取模式 */
function startPickPosition(): void {
  const dm = drawingManager.value
  if (!dm) return
  isPicking.value = true
  dm.onPointPicked = (pos) => {
    position.value = [pos.x, pos.y, pos.z]
    isPicking.value = false
    ElMessage.success('位置已拾取')
  }
  dm.startPicking()
}

/** 取消拾取(组件卸载或切换标签时调用) */
function cancelPick(): void {
  const dm = drawingManager.value
  if (!dm) return
  if (dm.isPickMode()) {
    dm.stopPicking()
  }
  isPicking.value = false
  // 清空回调,避免影响其他组件
  dm.onPointPicked = undefined
}

// ---------------- 创建 ----------------

async function handleCreate(): Promise<void> {
  if (!position.value) {
    ElMessage.warning('请先拾取红绿灯位置')
    return
  }
  creating.value = true
  try {
    const yawRad = (yawDeg.value * Math.PI) / 180
    const orientation: [number, number, number] = [0, 0, yawRad]
    const res = await createTrafficLight(
      position.value,
      orientation,
      laneletId.value,
      { state: state.value },
    )
    const id: number = res?.id
    if (id === undefined || id === null) {
      ElMessage.warning('创建红绿灯成功,但未返回 id')
      return
    }
    trafficLights.value.push({
      id,
      position: position.value,
      orientation,
      lanelet_id: laneletId.value,
      attrs: { state: state.value },
    })
    drawingManager.value?.addTrafficLightMesh(id, position.value, orientation, state.value)

    ElMessage.success(`红绿灯 #${id} 已创建`)
    emit('traffic-light-created', id)
    selectLight(id)

    // 重置表单
    position.value = null
    laneletId.value = null
    yawDeg.value = 0
  } catch (e: any) {
    console.error('[TrafficLightPanel] 创建红绿灯失败:', e)
    ElMessage.error('创建红绿灯失败: ' + (e?.response?.data?.detail || e?.message || ''))
  } finally {
    creating.value = false
  }
}

// ---------------- 加载 ----------------

async function loadTrafficLights(): Promise<void> {
  loadingList.value = true
  try {
    const items = await listTrafficLights()
    // 清空旧可视化
    drawingManager.value?.clearAllTrafficLightMeshes()
    trafficLights.value = items
    for (const tl of items) {
      drawingManager.value?.addTrafficLightMesh(
        tl.id,
        tl.position,
        tl.orientation ?? [0, 0, 0],
        tl.attrs?.state ?? 'red',
      )
    }
    ElMessage.success(`已加载 ${items.length} 个红绿灯`)
  } catch (e) {
    console.warn('[TrafficLightPanel] 加载红绿灯列表失败:', e)
    ElMessage.warning('加载红绿灯列表失败(后端可能未就绪)')
  } finally {
    loadingList.value = false
  }
}

async function loadLanelets(): Promise<void> {
  try {
    const items = await listLanelets()
    lanelets.value = (items as any[]).map(it => ({ id: it.id }))
  } catch {
    // 后端可能未就绪,保持空列表
  }
}

// ---------------- 选择 / 高亮 ----------------

function selectLight(id: number): void {
  // 取消旧高亮
  if (selectedId.value !== null) {
    drawingManager.value?.highlightTrafficLight(selectedId.value, false)
  }
  selectedId.value = id
  drawingManager.value?.highlightTrafficLight(id, true)
  // 同步状态选择器
  const tl = selectedLight.value
  if (tl) {
    state.value = tl.attrs?.state ?? 'red'
  }
}

function clearSelection(): void {
  if (selectedId.value !== null) {
    drawingManager.value?.highlightTrafficLight(selectedId.value, false)
  }
  selectedId.value = null
}

// ---------------- 删除 ----------------

async function handleDelete(tl: TrafficLight): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认删除红绿灯 #${tl.id}?此操作不可恢复`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }

  try {
    await deleteTrafficLight(tl.id)
  } catch (e) {
    console.warn('[TrafficLightPanel] 后端删除红绿灯失败:', e)
    ElMessage.warning('后端删除失败,仅从前端移除')
  }

  drawingManager.value?.removeTrafficLightMesh(tl.id)
  trafficLights.value = trafficLights.value.filter(t => t.id !== tl.id)
  if (selectedId.value === tl.id) {
    clearSelection()
  }
  emit('traffic-light-deleted', tl.id)
  ElMessage.success(`红绿灯 #${tl.id} 已删除`)
}

async function handleClearAll(): Promise<void> {
  try {
    await ElMessageBox.confirm('确认清空所有红绿灯?此操作不可恢复', '清空确认', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  const ids = trafficLights.value.map(t => t.id)
  for (const id of ids) {
    try {
      await deleteTrafficLight(id)
    } catch {
      // 忽略单个删除失败
    }
    drawingManager.value?.removeTrafficLightMesh(id)
    emit('traffic-light-deleted', id)
  }
  trafficLights.value = []
  clearSelection()
  ElMessage.success('已清空所有红绿灯')
}

// ---------------- 状态切换 ----------------

async function handleStateChange(newState: string): Promise<void> {
  const tl = selectedLight.value
  if (!tl) return
  // 本地立即更新可视化
  drawingManager.value?.setTrafficLightState(tl.id, newState)
  tl.attrs = { ...tl.attrs, state: newState }
  state.value = newState
  // 后端暂无更新接口,这里仅本地更新(可扩展)
  ElMessage.success(`红绿灯 #${tl.id} 已切换为 ${stateLabel(newState)}`)
}

// ---------------- 工具函数 ----------------

function stateColor(s?: string): string {
  const c = TRAFFIC_LIGHT_STATE_COLORS[s ?? 'unknown'] ?? 0xcccccc
  return '#' + c.toString(16).padStart(6, '0')
}

function stateLabel(s?: string): string {
  switch (s) {
    case 'red': return '红灯'
    case 'yellow': return '黄灯'
    case 'green': return '绿灯'
    default: return '未知'
  }
}

// ---------------- 生命周期 ----------------

let initialized = false
async function initOnce(): Promise<void> {
  if (initialized) return
  if (!drawingManager.value) return
  initialized = true
  await Promise.all([loadTrafficLights(), loadLanelets()])
}

watch(drawingManagerRef, () => {
  initOnce()
}, { immediate: true })

onBeforeUnmount(() => {
  // 退出拾取模式,清空高亮
  cancelPick()
  if (selectedId.value !== null) {
    drawingManager.value?.highlightTrafficLight(selectedId.value, false)
  }
})
</script>

<style scoped>
.traffic-light-panel {
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
  width: 56px;
  font-size: 12px;
  color: #606266;
  flex-shrink: 0;
  padding-top: 2px;
}

.form-row .el-select {
  flex: 1;
}

.pick-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pick-coord {
  font-size: 12px;
  color: #303133;
  font-family: 'Consolas', 'Monaco', monospace;
  word-break: break-all;
}

.unit {
  font-size: 12px;
  color: #909399;
  flex-shrink: 0;
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

.hint.info {
  color: #409eff;
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

.light-list {
  max-height: 220px;
  overflow-y: auto;
}

.light-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
}

.light-item:hover {
  background: #f5f7fa;
}

.light-item.active {
  background: #ecf5ff;
  border-left: 3px solid #409eff;
  padding-left: 1px;
}

.state-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid rgba(0, 0, 0, 0.15);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.1);
}

.light-info {
  flex: 1;
  min-width: 0;
}

.light-title {
  font-size: 13px;
  color: #303133;
}

.light-state {
  color: #606266;
  margin-left: 4px;
}

.light-meta {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
}

.state-row {
  display: flex;
  gap: 8px;
}

.state-row .el-button {
  flex: 1;
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
