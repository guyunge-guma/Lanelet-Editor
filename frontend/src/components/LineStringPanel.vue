<template>
  <div class="linestring-panel">
    <!-- 绘制模式开关 -->
    <el-button
      :type="isDrawingMode ? 'danger' : 'primary'"
      size="small"
      class="draw-toggle"
      :disabled="!drawingManager"
      @click="toggleDrawing"
    >
      {{ isDrawingMode ? '停止绘制' : '开始绘制' }}
    </el-button>

    <div v-if="!drawingManager" class="hint">
      Potree 未就绪,无法绘制
    </div>

    <!-- 类型 / 子类型选择 -->
    <div class="form-row">
      <label>类型</label>
      <el-select
        v-model="selectedType"
        size="small"
        :disabled="isDrawingMode || !drawingManager"
        @change="onTypeChange"
      >
        <el-option
          v-for="t in TYPE_OPTIONS"
          :key="t.value"
          :label="t.label"
          :value="t.value"
        />
      </el-select>
    </div>

    <div class="form-row">
      <label>子类型</label>
      <el-select
        v-model="selectedSubtype"
        size="small"
        :disabled="isDrawingMode || !drawingManager || subtypeOptions.length === 0"
        :placeholder="subtypeOptions.length === 0 ? '暂无子类型' : '请选择'"
      >
        <el-option
          v-for="s in subtypeOptions"
          :key="s.value"
          :label="s.label"
          :value="s.value"
        />
      </el-select>
    </div>

    <!-- 当前绘制状态 -->
    <div class="status-box">
      <span>状态:</span>
      <el-tag size="small" :type="isDrawingMode ? 'success' : 'info'">
        {{ isDrawingMode ? '绘制中' : '空闲' }}
      </el-tag>
      <span class="point-count">已添加点数: <b>{{ pointCount }}</b></span>
    </div>

    <!-- 操作按钮 -->
    <div class="action-row">
      <el-button
        size="small"
        :disabled="!isDrawingMode || pointCount === 0"
        @click="handleUndo"
      >
        撤销
      </el-button>
      <el-button
        size="small"
        type="success"
        :disabled="!isDrawingMode || pointCount < 2"
        @click="handleFinish"
      >
        完成
      </el-button>
      <el-button
        size="small"
        type="warning"
        :disabled="!isDrawingMode || pointCount === 0"
        @click="handleCancel"
      >
        取消
      </el-button>
    </div>

    <div class="tip">
      左键添加点 · 双击/回车完成 · 右键撤销 · Esc 取消当前线
    </div>

    <el-divider />

    <!-- 已绘制线段列表 -->
    <div class="list-header">
      <span>已绘制线段 ({{ lines.length }})</span>
      <el-button
        v-if="lines.length"
        size="small"
        link
        type="danger"
        @click="handleClearAll"
      >
        清空全部
      </el-button>
    </div>

    <div class="line-list">
      <div v-for="l in lines" :key="l.id" class="line-item">
        <span class="color-swatch" :style="{ background: colorCss(l.type) }" />
        <div class="line-info">
          <div class="line-title">
            #{{ lineIdMap.get(l.id) ?? l.id }}
            <span class="line-type">{{ typeLabel(l.type) }}</span>
            <span v-if="l.subtype" class="line-subtype">/ {{ subtypeLabel(l.type, l.subtype) }}</span>
          </div>
          <div class="line-meta">{{ l.pointCount }} 个点</div>
        </div>
        <el-button size="small" link type="danger" @click="handleDelete(l)">
          删除
        </el-button>
      </div>
      <el-empty v-if="!lines.length" description="暂无线段" :image-size="40" />
    </div>

    <el-divider />

    <!-- 颜色图例 -->
    <div class="legend">
      <div class="legend-title">颜色图例</div>
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
  TYPE_COLORS,
  TYPE_LABELS,
  LINESTRING_SUBTYPE_OPTIONS as SUBTYPE_OPTIONS,
  lineSubtypeLabel,
} from '../utils/DrawingManager'

// 从 MapView 注入 internalId → backendId 映射,用于统一显示后端 ID
const lineIdMap = inject<Map<number, number>>('lineIdMap', new Map())

/** 线段类型选项 */
const TYPE_OPTIONS = [
  { value: 'line_thin', label: '细线' },
  { value: 'line_thick', label: '粗线' },
  { value: 'curbstone', label: '路沿' },
  { value: 'virtual', label: '虚拟线' },
  { value: 'road_border', label: '道路边界' },
] as const

interface LineEntry {
  id: number
  type: string
  subtype: string
  pointCount: number
}

const emit = defineEmits<{
  (e: 'line-finished', coords: number[], type: string, subtype: string, id: number): void
  (e: 'line-deleted', id: number): void
}>()

// 通过 inject 获取 MapView 提供的 DrawingManager(响应式 ref)
const drawingManagerRef = inject<Ref<DrawingManager | null>>('drawingManager', ref(null))
const drawingManager = computed(() => drawingManagerRef.value)

const isDrawingMode = ref(false)
const selectedType = ref<string>('line_thin')
const selectedSubtype = ref<string>('solid')
const pointCount = ref(0)
const lines = ref<LineEntry[]>([])

const subtypeOptions = computed(() => SUBTYPE_OPTIONS[selectedType.value] ?? [])

/** 类型变化时,重置子类型为第一个可用项 */
function onTypeChange(val: string) {
  const opts = SUBTYPE_OPTIONS[val] ?? []
  selectedSubtype.value = opts.length ? opts[0].value : ''
}

/** 挂载 DrawingManager 回调 */
watch(
  drawingManagerRef,
  (dm) => {
    if (!dm) return
    dm.onPointAdded = (points: number[]) => {
      pointCount.value = Math.floor(points.length / 3)
    }
    dm.onModeChanged = (isDrawing: boolean) => {
      isDrawingMode.value = isDrawing
      if (!isDrawing) pointCount.value = 0
    }
    dm.onLineFinished = (coords: number[], type: string, subtype: string, id: number) => {
      lines.value.push({
        id,
        type,
        subtype,
        pointCount: Math.floor(coords.length / 3),
      })
      emit('line-finished', coords, type, subtype, id)
    }
  },
  { immediate: true },
)

/** 切换绘制模式 */
function toggleDrawing() {
  const dm = drawingManager.value
  if (!dm) return
  if (isDrawingMode.value) {
    dm.stopDrawing()
  } else {
    dm.startDrawing(selectedType.value, selectedSubtype.value)
  }
}

function handleUndo() {
  drawingManager.value?.undoLastPoint()
}

function handleFinish() {
  const result = drawingManager.value?.finishLine()
  if (!result) {
    ElMessage.warning('至少需要 2 个不同的点才能完成线段')
  }
}

function handleCancel() {
  drawingManager.value?.cancelDrawing()
  ElMessage.info('已取消当前线段')
}

function handleDelete(l: LineEntry) {
  drawingManager.value?.removeFinishedLine(l.id)
  lines.value = lines.value.filter(x => x.id !== l.id)
  emit('line-deleted', l.id)
}

async function handleClearAll() {
  try {
    await ElMessageBox.confirm('确认清空所有已绘制线段?此操作不可恢复', '清空确认', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  // 收集所有 id 后再删除(避免遍历时修改)
  const ids = lines.value.map(l => l.id)
  for (const id of ids) {
    drawingManager.value?.removeFinishedLine(id)
    emit('line-deleted', id)
  }
  lines.value = []
  ElMessage.success('已清空所有线段')
}

/** 0xRRGGBB -> css 颜色字符串 */
function colorCss(type: string): string {
  const c = TYPE_COLORS[type] ?? 0x999999
  return '#' + c.toString(16).padStart(6, '0')
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

function subtypeLabel(type: string, subtype: string): string {
  return lineSubtypeLabel(type, subtype)
}

onBeforeUnmount(() => {
  // 离开面板时退出绘制模式,避免事件残留
  drawingManager.value?.stopDrawing()
})
</script>

<style scoped>
.linestring-panel {
  padding: 4px 0;
}

.draw-toggle {
  width: 100%;
  margin-bottom: 12px;
}

.hint {
  color: #909399;
  font-size: 12px;
  margin-bottom: 8px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.form-row label {
  width: 48px;
  font-size: 12px;
  color: #606266;
  flex-shrink: 0;
}

.form-row .el-select {
  flex: 1;
}

.status-box {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 8px;
  padding: 8px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 12px;
}

.point-count {
  margin-left: auto;
  color: #606266;
}

.point-count b {
  color: #409eff;
}

.action-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.action-row .el-button {
  flex: 1;
}

.tip {
  font-size: 11px;
  color: #909399;
  line-height: 1.6;
  padding: 4px 0;
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

.line-list {
  max-height: 240px;
  overflow-y: auto;
}

.line-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  border-bottom: 1px solid #f0f0f0;
}

.line-item:hover {
  background: #f5f7fa;
}

.color-swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.line-info {
  flex: 1;
  min-width: 0;
}

.line-title {
  font-size: 13px;
  color: #303133;
}

.line-type {
  color: #606266;
  margin-left: 4px;
}

.line-subtype {
  color: #909399;
}

.line-meta {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
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
