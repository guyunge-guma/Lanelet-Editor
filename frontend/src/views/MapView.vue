<template>
  <div class="map-container">
    <!-- Potree 渲染区 -->
    <div ref="potreeContainer" class="potree-view"></div>

    <!-- 左侧工具栏 -->
    <aside class="sidebar">
      <el-tabs v-model="activeTab">
        <!-- 点云列表 -->
        <el-tab-pane label="点云" name="pointcloud">
          <el-button size="small" @click="refreshPointclouds" :loading="loading">
            刷新
          </el-button>
          <el-upload
            :show-file-list="false"
            :before-upload="handleUpload"
            accept=".pcd,.ply,.las,.laz"
          >
            <el-button size="small" type="primary" class="upload-btn">
              上传 PCD
            </el-button>
          </el-upload>
          <el-divider />
          <div v-for="pc in pointclouds" :key="pc.name" class="pc-item">
            <el-button size="small" link @click="loadPointcloud(pc)">
              {{ pc.name }}
            </el-button>
          </div>
          <el-empty v-if="!pointclouds.length" description="暂无点云" />
        </el-tab-pane>

        <!-- Lanelet2 元素(第 2 轮使用) -->
        <el-tab-pane label="元素" name="elements">
          <p class="hint">画线/车道功能将在第 2 轮实现</p>
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import * as THREE from 'three'
import { ElMessage } from 'element-plus'
import {
  listPointclouds,
  uploadPointcloud,
  type PointCloudItem,
} from '../api'

// Potree 库没有类型声明,用 any 处理
// @ts-ignore
import { Viewer as PotreeViewer } from 'potree'

const potreeContainer = ref<HTMLDivElement>()
const activeTab = ref('pointcloud')
const pointclouds = ref<PointCloudItem[]>([])
const loading = ref(false)
const currentPointcloud = ref('')
const mousePos = ref<{ x: number; y: number; z: number } | null>(null)

let viewer: any = null

// 初始化 Potree
function initPotree() {
  if (!potreeContainer.value) return

  viewer = new PotreeViewer(potreeContainer.value)

  // Potree 样式
  viewer.setEDLEnabled(true)
  viewer.setEDLRadius(1.0)
  viewer.setEDLStrength(0.4)
  viewer.setPointBudget(2_000_000)
  viewer.setBackground('gradient')

  // 加载 Potree GUI(可选,生产环境可关闭)
  viewer.loadGUI()

  // 鼠标移动时拾取坐标(供后续画线使用)
  setupMousePicking()
}

// 拾取点云坐标
function setupMousePicking() {
  if (!viewer) return
  // Potree 内部有 raycaster,这里通过事件监听
  const dom = viewer.renderer?.domElement || potreeContainer.value
  if (!dom) return

  // 鼠标移动时显示当前坐标
  dom.addEventListener('mousemove', () => {
    if (!viewer) return
    // Potree 有内置的 IFC picking,这里简单取视图中心
    // 真正的拾取在第 2 轮实现
  })

  // 点击拾取(占位)
  dom.addEventListener('click', () => {
    // 第 2 轮实现画线拾取
  })
}

// 加载点云
async function loadPointcloud(pc: PointCloudItem) {
  if (!viewer) return
  try {
    // Potree 标准 API
    viewer.loadPointCloud(pc.url, pc.name, (e: any) => {
      if (!e) {
        ElMessage.error('点云加载失败')
        return
      }
      viewer.scene.addPointCloud(e.pointcloud)
      viewer.fitToScreen()
      currentPointcloud.value = pc.name
      ElMessage.success(`已加载 ${pc.name}`)
    })
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message)
  }
}

// 刷新点云列表
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

// 上传点云
async function handleUpload(file: File): Promise<boolean> {
  try {
    const res = await uploadPointcloud(file)
    ElMessage.success(`已上传 ${file.name},需运行 PotreeConverter 转换后刷新`)
    await refreshPointclouds()
  } catch (e) {
    ElMessage.error('上传失败')
  }
  return false  // 阻止 el-upload 默认上传
}

onMounted(async () => {
  initPotree()
  await refreshPointclouds()
})

onBeforeUnmount(() => {
  // Potree 资源释放
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
  width: 280px;
  background: #fff;
  border-right: 1px solid #e0e0e0;
  padding: 12px;
  overflow-y: auto;
  flex-shrink: 0;
}

.upload-btn {
  margin-top: 8px;
  width: 100%;
}

.pc-item {
  padding: 4px 0;
}

.hint {
  color: #909399;
  font-size: 12px;
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
