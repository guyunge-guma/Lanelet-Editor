<template>
  <div class="file-manager">
    <!-- 上传区 -->
    <el-upload
      :show-file-list="false"
      :before-upload="handleUpload"
      accept=".pcd,.ply,.las,.laz"
      :disabled="uploading"
    >
      <el-button size="small" type="primary" :loading="uploading" class="upload-btn">
        {{ uploading ? '上传中...' : '上传点云' }}
      </el-button>
    </el-upload>

    <!-- 转换进度 -->
    <div v-if="converting" class="progress-box">
      <div class="progress-header">
        <span>{{ convertingName }}</span>
        <el-tag size="small" :type="statusTag">{{ statusText }}</el-tag>
      </div>
      <el-progress
        :percentage="convertingProgress"
        :status="progressStatus"
        :stroke-width="6"
      />
      <div class="progress-msg">{{ convertingMessage }}</div>
    </div>

    <el-divider />

    <!-- 刷新 -->
    <el-button size="small" link @click="refresh" :loading="loading" :disabled="converting">
      刷新
    </el-button>

    <!-- 文件列表 -->
    <div class="file-list">
      <div v-for="f in files" :key="f.name" class="file-item">
        <div class="file-info">
          <div class="file-name">
            <el-icon v-if="f.converted" class="icon-ok"><CircleCheckFilled /></el-icon>
            <el-icon v-else class="icon-wait"><Clock /></el-icon>
            <span>{{ f.name }}</span>
          </div>
          <div class="file-meta">
            <span>{{ f.ext.toUpperCase() }}</span>
            <span>{{ formatSize(f.size) }}</span>
            <span v-if="f.converted" class="tag-ok">已就绪</span>
            <span v-else-if="f.has_las" class="tag-wait">待转换</span>
            <span v-else class="tag-raw">原始</span>
          </div>
        </div>
        <div class="file-actions">
          <el-button
            v-if="f.converted"
            size="small"
            link
            type="primary"
            @click="$emit('load', f.name)"
          >
            加载
          </el-button>
          <el-dropdown trigger="click" @command="(cmd: string) => handleAction(cmd, f)">
            <el-icon class="more-btn"><MoreFilled /></el-icon>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="load" v-if="f.converted">加载到视图</el-dropdown-item>
                <el-dropdown-item command="download-pcd" v-if="hasExt(f, 'pcd')">
                  下载 PCD
                </el-dropdown-item>
                <el-dropdown-item command="download-las" v-if="f.has_las">
                  下载 LAS
                </el-dropdown-item>
                <el-dropdown-item command="rename">重命名</el-dropdown-item>
                <el-dropdown-item command="delete" divided>
                  <span style="color: #f56c6c">删除</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
      <el-empty v-if="!files.length && !loading" description="暂无点云,点击上方上传" :image-size="60" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CircleCheckFilled, Clock, MoreFilled } from '@element-plus/icons-vue'
import {
  listFiles,
  uploadPointcloud,
  deletePointcloud,
  renamePointcloud,
  downloadUrl,
  subscribeProgress,
  type FileItem,
  type ConvertStatus,
} from '../api'

const emit = defineEmits<{
  (e: 'load', name: string): void
}>()

const files = ref<FileItem[]>([])
const loading = ref(false)
const uploading = ref(false)

// 转换状态
const converting = ref(false)
const convertingName = ref('')
const convertingProgress = ref(0)
const convertingMessage = ref('')
const convertingStatus = ref<ConvertStatus | null>(null)
let eventSource: EventSource | null = null

const statusText = computed(() => {
  const s = convertingStatus.value?.status
  if (s === 'done') return '完成'
  if (s === 'error') return '失败'
  if (s === 'converting') return '转换中'
  return '等待中'
})

const statusTag = computed<'success' | 'danger' | 'warning' | 'info'>(() => {
  const s = convertingStatus.value?.status
  if (s === 'done') return 'success'
  if (s === 'error') return 'danger'
  if (s === 'converting') return 'warning'
  return 'info'
})

const progressStatus = computed<'success' | 'exception' | undefined>(() => {
  const s = convertingStatus.value?.status
  if (s === 'done') return 'success'
  if (s === 'error') return 'exception'
  return undefined
})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function hasExt(f: FileItem, ext: string): boolean {
  return f.ext.toLowerCase() === `.${ext}`
}

async function refresh() {
  loading.value = true
  try {
    files.value = await listFiles()
  } catch (e) {
    ElMessage.error('刷新失败')
  } finally {
    loading.value = false
  }
}

async function handleUpload(file: File): Promise<boolean> {
  if (converting.value) {
    ElMessage.warning('当前已有转换任务在进行')
    return false
  }
  uploading.value = true
  try {
    const res = await uploadPointcloud(file, true)
    ElMessage.success(`已上传 ${file.name},开始自动转换`)
    uploading.value = false

    if (res.task_id) {
      startProgressSubscription(res.name)
    } else {
      await refresh()
    }
  } catch (e: any) {
    uploading.value = false
    ElMessage.error('上传失败: ' + (e?.message || ''))
  }
  return false
}

function startProgressSubscription(name: string) {
  // 关闭旧的
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }

  converting.value = true
  convertingName.value = name
  convertingProgress.value = 0
  convertingMessage.value = '订阅进度...'
  convertingStatus.value = null

  eventSource = subscribeProgress(name, (status) => {
    convertingStatus.value = status
    convertingProgress.value = status.progress
    convertingMessage.value = status.message

    if (status.status === 'done') {
      ElMessage.success(`${name} 转换完成`)
      cleanupSubscription()
      refresh()
    } else if (status.status === 'error') {
      ElMessage.error(`${name} 转换失败: ${status.message}`)
      cleanupSubscription()
      refresh()
    }
  })

  // 超时保护(10 分钟)
  setTimeout(() => {
    if (converting.value && convertingStatus.value?.status !== 'done') {
      ElMessage.warning('转换超时,请稍后刷新查看状态')
      cleanupSubscription()
    }
  }, 10 * 60 * 1000)
}

function cleanupSubscription() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
  converting.value = false
  convertingName.value = ''
  convertingProgress.value = 0
  convertingMessage.value = ''
}

async function handleAction(cmd: string, f: FileItem) {
  if (cmd === 'load') {
    emit('load', f.name)
    return
  }
  if (cmd === 'download-pcd') {
    triggerDownload(f.name, 'pcd')
    return
  }
  if (cmd === 'download-las') {
    triggerDownload(f.name, 'las')
    return
  }
  if (cmd === 'rename') {
    handleRename(f)
    return
  }
  if (cmd === 'delete') {
    handleDelete(f)
  }
}

function triggerDownload(name: string, which: 'pcd' | 'las') {
  const url = downloadUrl(name, which)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.${which}`
  a.click()
}

async function handleRename(f: FileItem) {
  try {
    const { value } = await ElMessageBox.prompt('输入新名称(不含扩展名)', '重命名', {
      inputValue: f.name,
      inputPattern: /^[A-Za-z0-9_\-.]+$/,
      inputErrorMessage: '只允许字母、数字、下划线、连字符',
    })
    if (value === f.name) return
    await renamePointcloud(f.name, value)
    ElMessage.success(`已重命名为 ${value}`)
    await refresh()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('重命名失败: ' + (e?.message || ''))
  }
}

async function handleDelete(f: FileItem) {
  try {
    await ElMessageBox.confirm(
      `确认删除 ${f.name}? 将同时删除原始文件和转换结果,不可恢复`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    await deletePointcloud(f.name)
    ElMessage.success(`已删除 ${f.name}`)
    await refresh()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败: ' + (e?.message || ''))
  }
}

onMounted(() => {
  refresh()
})

onBeforeUnmount(() => {
  cleanupSubscription()
})
</script>

<style scoped>
.file-manager {
  padding: 4px 0;
}

.upload-btn {
  width: 100%;
}

.progress-box {
  margin-top: 12px;
  padding: 8px;
  background: #f5f7fa;
  border-radius: 4px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 500;
}

.progress-msg {
  margin-top: 4px;
  font-size: 11px;
  color: #909399;
  word-break: break-all;
}

.file-list {
  margin-top: 8px;
}

.file-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 4px;
  border-bottom: 1px solid #f0f0f0;
}

.file-item:hover {
  background: #f5f7fa;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-ok {
  color: #67c23a;
}

.icon-wait {
  color: #e6a23c;
}

.file-meta {
  margin-top: 2px;
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: #909399;
}

.tag-ok {
  color: #67c23a;
}

.tag-wait {
  color: #e6a23c;
}

.tag-raw {
  color: #909399;
}

.file-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.more-btn {
  cursor: pointer;
  font-size: 16px;
  color: #909399;
  padding: 2px;
}

.more-btn:hover {
  color: #409eff;
}
</style>
