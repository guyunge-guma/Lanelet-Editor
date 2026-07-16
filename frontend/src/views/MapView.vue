<template>
  <div class="map-container">
    <!-- Potree 渲染区 -->
    <div ref="potreeContainer" class="potree-view">
      <div v-if="initError" class="init-error">
        <p>{{ initError }}</p>
        <p style="font-size:11px;margin-top:4px">请按 F12 查看 Console 获取详细信息</p>
      </div>
      <!-- 浮动视图控制工具栏 -->
      <div class="view-toolbar">
        <el-tooltip content="撤销 (Ctrl+Z)" placement="bottom">
          <el-button size="small" :disabled="!canUndo" @click="handleUndo">
            ↶ 撤销
          </el-button>
        </el-tooltip>
        <el-tooltip content="重做 (Ctrl+Y)" placement="bottom">
          <el-button size="small" :disabled="!canRedo" @click="handleRedo">
            ↷ 重做
          </el-button>
        </el-tooltip>
        <el-divider direction="vertical" />
        <el-tooltip content="隐藏/显示点云,仅看标注" placement="bottom">
          <el-button
            size="small"
            :type="annotationOnlyMode ? 'primary' : 'default'"
            @click="toggleAnnotationOnly"
          >
            {{ annotationOnlyMode ? '☰ 仅看标注' : '☰ 显示全部' }}
          </el-button>
        </el-tooltip>
        <el-tooltip content="标注始终显示在点云上层(穿透显示)" placement="bottom">
          <el-button
            size="small"
            :type="annotationOnTop ? 'primary' : 'default'"
            @click="toggleAnnotationOnTop"
          >
            {{ annotationOnTop ? '↑ 标注置顶' : '↑ 正常深度' }}
          </el-button>
        </el-tooltip>
        <el-divider direction="vertical" />
        <el-tooltip content="自动吸附到已有线段端点/点云表面" placement="bottom">
          <el-button size="small" :type="snapEnabled ? 'primary' : 'default'" @click="toggleSnap">
            吸附
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <!-- 左侧工具栏 -->
    <aside class="sidebar">
      <el-tabs v-model="activeTab">
        <!-- 文件管理(上传/转换/删除/下载) -->
        <el-tab-pane label="文件" name="files">
          <FileManager @load="loadPointcloudByName" />
        </el-tab-pane>

        <!-- 点云列表(已就绪的,快速加载) -->
        <el-tab-pane label="点云" name="pointcloud">
          <el-button size="small" @click="refreshPointclouds" :loading="loading" style="margin-bottom:8px">
            刷新
          </el-button>
          <div v-for="pc in pointclouds" :key="pc.name" class="pc-item">
            <el-button size="small" link @click="loadPointcloud(pc)">
              <el-icon style="margin-right:4px"><Files /></el-icon>
              {{ pc.name }}
            </el-button>
          </div>
          <el-empty v-if="!pointclouds.length" description="暂无就绪点云" :image-size="40" />
        </el-tab-pane>

        <!-- Lanelet2 元素:LineString 绘制 / Lanelet 组装 -->
        <el-tab-pane label="元素" name="elements">
          <div class="elements-toolbar">
            <el-button size="small" @click="handleExportOsm" :loading="exporting">
              导出 OSM
            </el-button>
          </div>
          <!-- 元素子标签:LineString / Lanelet -->
          <el-radio-group v-model="elementSubTab" size="small" class="element-subtabs">
            <el-radio-button value="linestring">LineString</el-radio-button>
            <el-radio-button value="lanelet">Lanelet</el-radio-button>
          </el-radio-group>
          <!-- 使用 v-show 保持两个面板挂载,避免切换时丢失本地状态 -->
          <div v-show="elementSubTab === 'linestring'">
            <LineStringPanel @line-finished="onLineFinished" @line-deleted="onLineDeleted" @line-updated="onLineUpdated" />
          </div>
          <div v-show="elementSubTab === 'lanelet'">
            <LaneletPanel
              :linestrings="linestringsForLanelet"
              @lanelet-created="onLaneletCreated"
              @lanelet-deleted="onLaneletDeleted"
              @lanelet-selected="onLaneletSelected"
            />
          </div>
        </el-tab-pane>

        <!-- 交通元素:红绿灯 / Regulatory Element -->
        <el-tab-pane label="交通元素" name="traffic">
          <el-radio-group v-model="trafficSubTab" size="small" class="element-subtabs">
            <el-radio-button value="traffic_light">红绿灯</el-radio-button>
            <el-radio-button value="regulatory">规则元素</el-radio-button>
          </el-radio-group>
          <div v-show="trafficSubTab === 'traffic_light'">
            <TrafficLightPanel
              @traffic-light-created="onTrafficLightCreated"
              @traffic-light-deleted="onTrafficLightDeleted"
            />
          </div>
          <div v-show="trafficSubTab === 'regulatory'">
            <RegulatoryPanel
              @regulatory-created="onRegulatoryCreated"
              @regulatory-deleted="onRegulatoryDeleted"
            />
          </div>
        </el-tab-pane>

        <!-- 校验:拓扑 / 几何 -->
        <el-tab-pane label="校验" name="validation">
          <div class="validation-toolbar">
            <el-button size="small" type="primary" @click="runTopologyValidation" :loading="topoValidating">
              校验拓扑
            </el-button>
            <el-button size="small" type="primary" @click="runGeometryValidation" :loading="geoValidating">
              校验几何
            </el-button>
          </div>

          <!-- 拓扑校验结果 -->
          <div class="val-section">
            <div class="val-header">
              <span>拓扑校验</span>
              <el-tag v-if="topoResult" size="small" :type="topoValid ? 'success' : 'danger'">
                {{ topoValid ? '通过' : '存在问题' }}
              </el-tag>
            </div>
            <div v-if="topoResult && topoResult.length" class="issue-list">
              <div
                v-for="(issue, idx) in topoResult"
                :key="'topo-' + idx"
                class="issue-item"
              >
                <el-tag size="small" :type="issueTagType(issue.type)">{{ issueTypeLabel(issue.type) }}</el-tag>
                <span class="issue-msg">{{ issue.message }}</span>
                <span v-if="issue.lanelet_id !== undefined && issue.lanelet_id !== null" class="issue-id">
                  #{{ issue.lanelet_id }}
                </span>
              </div>
            </div>
            <el-empty v-else-if="topoResult" description="无问题" :image-size="32" />
            <div v-else class="val-empty">尚未执行</div>
          </div>

          <!-- 几何校验结果 -->
          <div class="val-section">
            <div class="val-header">
              <span>几何校验</span>
              <el-tag v-if="geoResult" size="small" :type="geoValid ? 'success' : 'danger'">
                {{ geoValid ? '通过' : '存在问题' }}
              </el-tag>
            </div>
            <div v-if="geoResult && geoResult.length" class="issue-list">
              <div
                v-for="(issue, idx) in geoResult"
                :key="'geo-' + idx"
                class="issue-item"
              >
                <el-tag size="small" :type="issueTagType(issue.type)">{{ issueTypeLabel(issue.type) }}</el-tag>
                <span class="issue-msg">{{ issue.message }}</span>
                <span v-if="issue.id !== undefined && issue.id !== null" class="issue-id">
                  #{{ issue.id }}
                </span>
              </div>
            </div>
            <el-empty v-else-if="geoResult" description="无问题" :image-size="32" />
            <div v-else class="val-empty">尚未执行</div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </aside>

    <!-- 右侧状态面板 -->
    <div class="status-panel">
      <div class="status-row">
        <span>点云:</span>
        <span>{{ currentPointcloud || '未加载' }}</span>
      </div>
      <div class="status-row">
        <span>坐标:</span>
        <span v-if="mousePos">{{ mousePos.x.toFixed(2) }}, {{ mousePos.y.toFixed(2) }}, {{ mousePos.z.toFixed(2) }}</span>
        <span v-else>-</span>
      </div>
      <div class="status-row">
        <span>线段:</span>
        <span>{{ lineIdMap.size }} 条已保存</span>
      </div>
      <div class="status-row">
        <span>Lanelet:</span>
        <span>{{ selectedLaneletId !== null ? `已选中 #${selectedLaneletId}` : '未选中' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef, reactive, computed, provide, watch, type Ref, markRaw } from 'vue'
import { ElMessage } from 'element-plus'
import { Files } from '@element-plus/icons-vue'
import FileManager from '../components/FileManager.vue'
import LineStringPanel from '../components/LineStringPanel.vue'
import LaneletPanel from '../components/LaneletPanel.vue'
import TrafficLightPanel from '../components/TrafficLightPanel.vue'
import RegulatoryPanel from '../components/RegulatoryPanel.vue'
import { DrawingManager, type MousePos } from '../utils/DrawingManager'
import {
  listPointclouds,
  createLinestring,
  deleteLinestring,
  exportOsm,
  validateTopology,
  validateGeometry,
  type PointCloudItem,
  type TopologyIssue,
  type GeometryIssue,
} from '../api'

const getPotree = () => (window as any).Potree
const getTHREE = () => {
  // potree.js 已在构建时打补丁,内部 THREE 暴露到 Potree.THREE
  // 这样应用代码与 Potree 使用同一个 THREE 实例,消除双实例兼容性问题
  const Potree = (window as any).Potree
  if (Potree?.THREE) return Potree.THREE
  if ((window as any).THREE) return (window as any).THREE
  return null
}

const potreeContainer = ref<HTMLDivElement>()
const activeTab = ref('files')
// 元素子标签:LineString / Lanelet
const elementSubTab = ref<'linestring' | 'lanelet'>('linestring')
// 交通元素子标签:红绿灯 / 规则元素
const trafficSubTab = ref<'traffic_light' | 'regulatory'>('traffic_light')
const pointclouds = ref<PointCloudItem[]>([])
const loading = ref(false)
const currentPointcloud = ref('')
const mousePos = ref<MousePos | null>(null)
const initError = ref('')
const exporting = ref(false)

// 标注视图模式
const annotationOnlyMode = ref(false) // 隐藏点云,仅看标注
const annotationOnTop = ref(true)      // 标注始终穿透点云显示(默认开启)

// 撤销/重做状态
const canUndo = ref(false)
const canRedo = ref(false)

// 吸附设置(与 LineStringPanel 共享,通过 provide/inject 同步)
const snapEnabled = ref(false)
const snapThreshold = ref(1.5)
provide('snapEnabled', snapEnabled)
provide('snapThreshold', snapThreshold)

// 校验结果(validateTopology / validateGeometry 直接返回 issue 数组)
const topoResult = ref<TopologyIssue[] | null>(null)
const geoResult = ref<GeometryIssue[] | null>(null)
const topoValidating = ref(false)
const geoValidating = ref(false)

// 是否通过(无问题)
const topoValid = computed(() => topoResult.value !== null && topoResult.value.length === 0)
const geoValid = computed(() => geoResult.value !== null && geoResult.value.length === 0)

let viewer: any = null
// 将 viewer 暴露为响应式 ref,供子组件(如 LaneletPanel)inject 使用
// Potree viewer 同样使用 shallowRef,避免深度代理内部 THREE 对象
const viewerRef = shallowRef<any>(null)
provide('viewer', viewerRef)

// DrawingManager 通过 provide 传给 LineStringPanel / LaneletPanel
// 使用 shallowRef + markRaw: 只跟踪 null/非 null 变化,不深度代理 THREE 对象
// (THREE.js 的事件系统和方法通过 Vue Proxy 访问时 this 绑定错乱,
//  导致 geometry.attributes.position 返回 undefined、dispose 崩溃等)
const drawingManagerRef = shallowRef<DrawingManager | null>(null)
provide('drawingManager', drawingManagerRef)

// 前端内部线段 id -> 后端 LineString id 的映射
// 用 reactive(Map) 使子组件能响应式读取后端 ID 用于统一显示
const lineIdMap = reactive(new Map<number, number>())
provide('lineIdMap', lineIdMap)

// 传给 LaneletPanel 的 LineString 列表(使用后端 id,用于选择左右边界)
interface LineStringForLanelet {
  id: number
  type: string
  subtype: string
  pointCount: number
}
const linestringsForLanelet = ref<LineStringForLanelet[]>([])

// 当前选中的 Lanelet id(状态栏显示用)
const selectedLaneletId = ref<number | null>(null)

function initPotree() {
  initError.value = ''
  if (!potreeContainer.value) {
    initError.value = '容器未就绪'
    return
  }

  const Potree = getPotree()
  if (!Potree) {
    initError.value = 'Potree 库未加载(检查 /potree/potree.js 是否 200 且非空)'
    ElMessage.error(initError.value)
    return
  }
  if (typeof Potree.Viewer !== 'function') {
    initError.value = 'Potree.Viewer 不是函数,可能 jQuery 未加载'
    ElMessage.error(initError.value)
    return
  }

  try {
    viewer = new Potree.Viewer(potreeContainer.value)
    viewer.setEDLEnabled(true)
    viewer.setEDLRadius(1.0)
    viewer.setEDLStrength(0.4)
    viewer.setPointBudget(2_000_000)
    viewer.setBackground('gradient')

    // Potree 1.8 默认导航: 左键旋转, 右键平移, 滚轮缩放
    // 绘制模式下 DrawingManager 会拦截左键 click 放置锚点,
    // 右键拖拽平移和滚轮缩放保持可用

    viewer.loadGUI((() => {
      const toggle = document.querySelector('#potree_sidebar_container')
      if (toggle) (toggle as HTMLElement).style.display = 'none'
    }))
    console.log('[Lanelet Editor] Potree Viewer 初始化成功')

    // 将 viewer 暴露给子组件
    viewerRef.value = markRaw(viewer)

    // 初始化绘制管理器
    // three.js 可能还在异步加载中,等待最多 3 秒
    const initDrawing = (retry = 0) => {
      const THREE = getTHREE()
      if (!THREE) {
        if (retry < 30) {
          setTimeout(() => initDrawing(retry + 1), 100)
        } else {
          ElMessage.warning('THREE 库未加载,LineString 绘制功能不可用')
          console.error('[Lanelet Editor] THREE 加载超时,DrawingManager 未初始化')
        }
        return
      }
      const dm = markRaw(new DrawingManager(viewer, THREE))
      dm.lineIdMap = lineIdMap
      drawingManagerRef.value = dm
      // 实时鼠标坐标显示(绘制/非绘制模式下均生效)
      drawingManagerRef.value.onMouseMove = (pos: MousePos | null) => {
        mousePos.value = pos
      }
      drawingManagerRef.value.onCollision = (msg: string) => {
        ElMessage.warning(msg)
      }
      // 撤销/重做回调: 更新按钮状态
      drawingManagerRef.value.onHistoryChanged = () => {
        canUndo.value = drawingManagerRef.value?.canUndo ?? false
        canRedo.value = drawingManagerRef.value?.canRedo ?? false
      }
      // 同步当前吸附设置到 DrawingManager
      dm.setSnapEnabled(snapEnabled.value)
      dm.setSnapThreshold(snapThreshold.value)
      // 注册全局键盘快捷键
      window.addEventListener('keydown', handleGlobalKeyDown, true)
      console.log('[Lanelet Editor] DrawingManager 初始化成功')
    }
    initDrawing()
  } catch (err) {
    initError.value = 'Potree 初始化异常: ' + (err as Error).message
    ElMessage.error(initError.value)
    console.error('[Lanelet Editor] Potree init error:', err)
  }
}

// ---------------- 标注视图模式控制 ----------------

/** 撤销 */
function handleUndo(): void {
  const ok = drawingManagerRef.value?.undo() ?? false
  if (!ok) ElMessage.info('无可撤销操作')
}

/** 重做 */
function handleRedo(): void {
  const ok = drawingManagerRef.value?.redo() ?? false
  if (!ok) ElMessage.info('无可重做操作')
}

/** 全局键盘快捷键: Ctrl+Z 撤销, Ctrl+Y / Ctrl+Shift+Z 重做(非绘制模式) */
function handleGlobalKeyDown(e: KeyboardEvent): void {
  // 绘制模式下不拦截(由 DrawingManager 内部处理)
  if (drawingManagerRef.value?.getIsDrawing()) return
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      handleUndo()
    } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
      e.preventDefault()
      handleRedo()
    }
  }
}

/** 切换"仅看标注"模式:隐藏/显示点云 */
function toggleAnnotationOnly(): void {
  annotationOnlyMode.value = !annotationOnlyMode.value
  const v = viewerRef.value
  if (!v) return
  // Potree 的 pointclouds 数组每个有 visible 属性
  // 隐藏所有点云,但保留 THREE.js 场景中的标注对象
  for (const pc of (v.scene?.pointclouds ?? [])) {
    pc.visible = !annotationOnlyMode.value
  }
  // 同时隐藏 Potree 自带的场景元素(网格等)
  if (v.scene?.scene) {
    v.scene.scene.visible = !annotationOnlyMode.value
  }
  ElMessage.info(annotationOnlyMode.value ? '已切换到标注模式(隐藏点云)' : '已恢复全部显示')
}

/** 切换"标注置顶"模式:标注材质的 depthTest 开关 */
function toggleAnnotationOnTop(): void {
  annotationOnTop.value = !annotationOnTop.value
  const dm = drawingManagerRef.value
  if (dm) {
    dm.setAnnotationOnTop(annotationOnTop.value)
  }
  ElMessage.info(annotationOnTop.value ? '标注已置顶(穿透点云显示)' : '标注恢复深度渲染')
}

/** 切换吸附开关 */
function toggleSnap(): void {
  snapEnabled.value = !snapEnabled.value
  ElMessage.info(snapEnabled.value ? '已开启自动吸附' : '已关闭自动吸附')
}

// 通过名字加载点云(FileManager 触发)
async function loadPointcloudByName(name: string) {
  const pc = pointclouds.value.find(p => p.name === name)
  if (pc) {
    await loadPointcloud(pc)
  } else {
    // 列表里没有,刷新后加载
    await refreshPointclouds()
    const pc2 = pointclouds.value.find(p => p.name === name)
    if (pc2) {
      await loadPointcloud(pc2)
    } else {
      ElMessage.error(`点云 ${name} 未就绪`)
    }
  }
}

async function loadPointcloud(pc: PointCloudItem) {
  const Potree = getPotree()
  if (!viewer || !Potree) {
    ElMessage.error('Potree 未初始化: ' + (initError.value || '未知原因'))
    return
  }
  try {
    console.log('[Lanelet Editor] 加载点云:', pc.url)

    // 移除旧点云,避免多个点云叠加
    // Potree 1.8.2 的 scene 没有 removePointCloud 方法
    // 注意: 不能立即 dispose geometry/material,因为 Potree 渲染循环是异步的,
    // 立即销毁会导致渲染循环读到 null.attributes 而崩溃。
    // 只从数组移除 + 标记不可见,让渲染循环自然跳过,延迟一帧后再 dispose。
    const oldPointClouds = [...(viewer.scene.pointclouds || [])]
    for (const oldPc of oldPointClouds) {
      oldPc.visible = false
      viewer.scene.pointclouds.splice(viewer.scene.pointclouds.indexOf(oldPc), 1)
    }
    // 延迟释放 GPU 资源(等渲染循环跑完当前帧)
    if (oldPointClouds.length > 0) {
      setTimeout(() => {
        for (const oldPc of oldPointClouds) {
          try {
            if (oldPc.geometry) oldPc.geometry.dispose()
            if (oldPc.material) oldPc.material.dispose()
          } catch (e) {
            // 已被释放,忽略
          }
        }
      }, 500)
    }

    Potree.loadPointCloud(pc.url, pc.name, (e: any) => {
      if (!e) {
        ElMessage.error('点云加载失败(回调返回空)')
        return
      }
      viewer.scene.addPointCloud(e.pointcloud)
      viewer.fitToScreen()
      currentPointcloud.value = pc.name
      // 通知绘制管理器点云已变更(重置悬停坐标等)
      drawingManagerRef.value?.notifyPointcloudChanged()
      ElMessage.success(`已加载 ${pc.name}`)
    })
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message)
    console.error('[Lanelet Editor] loadPointCloud error:', err)
  }
}

async function refreshPointclouds() {
  loading.value = true
  try {
    pointclouds.value = await listPointclouds()
  } catch (e) {
    ElMessage.error('刷新失败')
  } finally {
    loading.value = false
  }
}

// ---------------- LineStringPanel 事件处理 ----------------

/** 线段绘制完成:持久化到后端,建立内部 id -> 后端 id 映射 */
async function onLineFinished(coords: number[], type: string, subtype: string, internalId: number) {
  try {
    const res = await createLinestring(coords, { type, subtype })
    if (res?.id !== undefined) {
      lineIdMap.set(internalId, res.id)
      // 同步到 LaneletPanel 可用的边界列表
      linestringsForLanelet.value.push({
        id: res.id,
        type,
        subtype,
        pointCount: Math.floor(coords.length / 3),
      })
      ElMessage.success(`线段已保存(后端 id: ${res.id})`)
    }
  } catch (e: any) {
    // 后端可能未安装 lanelet2 或接口异常,线段仍保留在前端
    console.warn('[Lanelet Editor] 线段保存后端失败:', e)
    ElMessage.warning('线段保存到后端失败,仅保留在前端')
  }
}

/** 线段删除:同步删除后端数据 */
async function onLineDeleted(internalId: number) {
  const backendId = lineIdMap.get(internalId)
  lineIdMap.delete(internalId)
  if (backendId === undefined) return
  // 从 LaneletPanel 可用边界列表中移除
  linestringsForLanelet.value = linestringsForLanelet.value.filter(l => l.id !== backendId)
  try {
    await deleteLinestring(backendId)
  } catch (e) {
    // 后端可能暂不支持删除接口,前端已删除,忽略
    console.warn('[Lanelet Editor] 后端删除线段失败:', e)
  }
}

/** 线段类型更新(批量改类型):同步 linestringsForLanelet 中的类型信息 */
function onLineUpdated(internalId: number, type: string, subtype: string) {
  const backendId = lineIdMap.get(internalId)
  if (backendId === undefined) return
  const line = linestringsForLanelet.value.find(l => l.id === backendId)
  if (line) {
    line.type = type
    line.subtype = subtype
  }
}

// ---------------- LaneletPanel 事件处理 ----------------

/** Lanelet 创建成功 */
function onLaneletCreated(id: number) {
  console.log('[Lanelet Editor] Lanelet 已创建:', id)
}

/** Lanelet 删除 */
function onLaneletDeleted(id: number) {
  if (selectedLaneletId.value === id) {
    selectedLaneletId.value = null
  }
}

/** Lanelet 选中变化(用于状态栏显示) */
function onLaneletSelected(id: number | null) {
  selectedLaneletId.value = id
}

// ---------------- TrafficLightPanel 事件处理 ----------------

function onTrafficLightCreated(id: number) {
  console.log('[Lanelet Editor] TrafficLight 已创建:', id)
}

function onTrafficLightDeleted(id: number) {
  console.log('[Lanelet Editor] TrafficLight 已删除:', id)
}

// ---------------- RegulatoryPanel 事件处理 ----------------

function onRegulatoryCreated(id: number) {
  console.log('[Lanelet Editor] RegulatoryElement 已创建:', id)
}

function onRegulatoryDeleted(id: number) {
  console.log('[Lanelet Editor] RegulatoryElement 已删除:', id)
}

// ---------------- 校验 ----------------

/** 运行拓扑校验 */
async function runTopologyValidation(): Promise<void> {
  topoValidating.value = true
  try {
    const res = await validateTopology()
    topoResult.value = res
    ElMessage.success(`拓扑校验完成: ${res.length} 个问题`)
  } catch (e: any) {
    console.error('[Lanelet Editor] 拓扑校验失败:', e)
    ElMessage.error('拓扑校验失败: ' + (e?.response?.data?.detail || e?.message || ''))
  } finally {
    topoValidating.value = false
  }
}

/** 运行几何校验 */
async function runGeometryValidation(): Promise<void> {
  geoValidating.value = true
  try {
    const res = await validateGeometry()
    geoResult.value = res
    ElMessage.success(`几何校验完成: ${res.length} 个问题`)
  } catch (e: any) {
    console.error('[Lanelet Editor] 几何校验失败:', e)
    ElMessage.error('几何校验失败: ' + (e?.response?.data?.detail || e?.message || ''))
  } finally {
    geoValidating.value = false
  }
}

/** 问题类型 -> el-tag type */
function issueTagType(type: string): 'danger' | 'warning' | 'info' {
  switch (type) {
    case 'overlap':
    case 'boundary_cross':
    case 'direction_conflict':
      return 'danger'
    case 'isolated':
    case 'dangling':
    case 'self_intersect':
      return 'warning'
    default:
      return 'info'
  }
}

/** 问题类型中文标签 */
function issueTypeLabel(type: string): string {
  switch (type) {
    case 'isolated': return '孤立'
    case 'dangling': return '断头'
    case 'direction_conflict': return '方向冲突'
    case 'overlap': return '重叠'
    case 'self_intersect': return '自相交'
    case 'boundary_cross': return '边界交叉'
    default: return type
  }
}

/** 导出 OSM */
async function handleExportOsm() {
  exporting.value = true
  try {
    const res = await exportOsm()
    ElMessage.success(`已导出: ${res?.path ?? ''}`)
  } catch (e: any) {
    ElMessage.error('导出失败: ' + (e?.response?.data?.detail || e?.message || ''))
  } finally {
    exporting.value = false
  }
}

// 切换离开"元素"标签或从 LineString 子标签切到 Lanelet 时退出绘制模式,避免事件残留
watch(activeTab, (tab) => {
  if (tab !== 'elements') {
    drawingManagerRef.value?.stopDrawing()
  }
  // 离开"交通元素"标签时退出绘制与拾取模式(红绿灯拾取位置等)
  if (tab !== 'traffic') {
    drawingManagerRef.value?.stopDrawing()
    drawingManagerRef.value?.stopPicking()
  }
})

watch(elementSubTab, (sub) => {
  // 离开 LineString 绘制子标签时停止绘制
  if (sub !== 'linestring') {
    drawingManagerRef.value?.stopDrawing()
  }
})

watch(trafficSubTab, (sub) => {
  // 切换交通元素子标签时退出拾取模式,避免事件残留
  drawingManagerRef.value?.stopPicking()
})

// 吸附设置变化时同步到 DrawingManager
watch([snapEnabled, snapThreshold], () => {
  const dm = drawingManagerRef.value
  if (!dm) return
  dm.setSnapEnabled(snapEnabled.value)
  dm.setSnapThreshold(snapThreshold.value)
})

onMounted(async () => {
  initPotree()
  await refreshPointclouds()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeyDown, true)
  drawingManagerRef.value?.dispose()
  drawingManagerRef.value = null
  if (viewer?.renderer) {
    viewer.renderer.dispose()
  }
  viewer = null
  viewerRef.value = null
})
</script>

<style scoped>
.map-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
}

.potree-view {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.view-toolbar {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  display: flex;
  gap: 6px;
  padding: 4px 6px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}

.view-toolbar .el-button {
  margin: 0;
  font-size: 12px;
}

.sidebar {
  width: 300px;
  background: #fff;
  border-right: 1px solid #e0e0e0;
  padding: 12px;
  overflow-y: auto;
  flex-shrink: 0;
}

.pc-item {
  padding: 4px 0;
}

.hint {
  color: #909399;
  font-size: 12px;
  padding: 8px 0;
}

.init-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(245, 108, 108, 0.9);
  color: #fff;
  padding: 12px 20px;
  border-radius: 6px;
  font-size: 13px;
  text-align: center;
  z-index: 10;
  max-width: 400px;
}

.elements-toolbar {
  margin-bottom: 8px;
}

.element-subtabs {
  width: 100%;
  margin-bottom: 12px;
  display: flex;
}

.element-subtabs :deep(.el-radio-button) {
  flex: 1;
}

.element-subtabs :deep(.el-radio-button__inner) {
  width: 100%;
  text-align: center;
}

.validation-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.validation-toolbar .el-button {
  flex: 1;
}

.val-section {
  margin-bottom: 16px;
}

.val-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 8px;
}

.issue-list {
  max-height: 200px;
  overflow-y: auto;
}

.issue-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 12px;
}

.issue-msg {
  flex: 1;
  color: #303133;
  word-break: break-all;
  line-height: 1.5;
}

.issue-id {
  color: #909399;
  font-size: 11px;
  flex-shrink: 0;
}

.val-empty {
  font-size: 12px;
  color: #909399;
  padding: 8px 0;
}

.status-panel {
  position: absolute;
  bottom: 12px;
  right: 12px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 12px;
  z-index: 100;
}

.status-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  line-height: 20px;
}

.status-row span:first-child {
  color: #909399;
}
</style>
