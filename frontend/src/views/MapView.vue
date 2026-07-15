<template>
  <div class="map-container">
    <!-- Potree 渲染区 -->
    <div ref="potreeContainer" class="potree-view">
      <div v-if="initError" class="init-error">
        <p>{{ initError }}</p>
        <p style="font-size:11px;margin-top:4px">请按 F12 查看 Console 获取详细信息</p>
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

        <!-- Lanelet2 元素:LineString 绘制 -->
        <el-tab-pane label="元素" name="elements">
          <div class="elements-toolbar">
            <el-button size="small" @click="handleExportOsm" :loading="exporting">
              导出 OSM
            </el-button>
          </div>
          <LineStringPanel @line-finished="onLineFinished" @line-deleted="onLineDeleted" />
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, provide, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Files } from '@element-plus/icons-vue'
import FileManager from '../components/FileManager.vue'
import LineStringPanel from '../components/LineStringPanel.vue'
import { DrawingManager, type MousePos } from '../utils/DrawingManager'
import {
  listPointclouds,
  createLinestring,
  deleteLinestring,
  exportOsm,
  type PointCloudItem,
} from '../api'

const getPotree = () => (window as any).Potree
const getTHREE = () => (window as any).THREE || (window as any).Potree?.THREE

const potreeContainer = ref<HTMLDivElement>()
const activeTab = ref('files')
const pointclouds = ref<PointCloudItem[]>([])
const loading = ref(false)
const currentPointcloud = ref('')
const mousePos = ref<MousePos | null>(null)
const initError = ref('')
const exporting = ref(false)

let viewer: any = null

// DrawingManager 通过 provide 传给 LineStringPanel(响应式 ref,初始为 null,
// Potree 初始化完成后赋值)
const drawingManagerRef = ref<DrawingManager | null>(null)
provide('drawingManager', drawingManagerRef)

// 前端内部线段 id -> 后端 LineString id 的映射
const lineIdMap = new Map<number, number>()

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
    viewer.loadGUI((() => {
      const toggle = document.querySelector('#potree_sidebar_container')
      if (toggle) (toggle as HTMLElement).style.display = 'none'
    }))
    console.log('[Lanelet Editor] Potree Viewer 初始化成功')

    // 初始化绘制管理器
    const THREE = getTHREE()
    if (!THREE) {
      ElMessage.warning('THREE 库未加载,LineString 绘制功能不可用')
    } else {
      drawingManagerRef.value = new DrawingManager(viewer, THREE)
      // 实时鼠标坐标显示(绘制/非绘制模式下均生效)
      drawingManagerRef.value.onMouseMove = (pos: MousePos | null) => {
        mousePos.value = pos
      }
      console.log('[Lanelet Editor] DrawingManager 初始化成功')
    }
  } catch (err) {
    initError.value = 'Potree 初始化异常: ' + (err as Error).message
    ElMessage.error(initError.value)
    console.error('[Lanelet Editor] Potree init error:', err)
  }
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
  try {
    await deleteLinestring(backendId)
  } catch (e) {
    // 后端可能暂不支持删除接口,前端已删除,忽略
    console.warn('[Lanelet Editor] 后端删除线段失败:', e)
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

// 切换离开"元素"标签时退出绘制模式,避免事件残留
watch(activeTab, (tab) => {
  if (tab !== 'elements') {
    drawingManagerRef.value?.stopDrawing()
  }
})

onMounted(async () => {
  initPotree()
  await refreshPointclouds()
})

onBeforeUnmount(() => {
  drawingManagerRef.value?.dispose()
  drawingManagerRef.value = null
  if (viewer?.renderer) {
    viewer.renderer.dispose()
  }
  viewer = null
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
