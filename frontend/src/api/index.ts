import axios from 'axios'

const http = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

export interface HealthInfo {
  status: string
  lanelet2_available: boolean
  origin: { lat: number; lon: number }
  data_dir: string
  potreeconverter: boolean
}

export interface PointCloudItem {
  name: string
  url: string
}

export interface FileItem {
  name: string
  ext: string
  size: number
  created_at: number
  has_las: boolean
  converted: boolean
  status: string  // 'done' | 'pending' | 'raw'
}

export interface ConvertStatus {
  status: string  // 'pending' | 'converting' | 'done' | 'error' | 'unknown'
  stage: string
  progress: number
  message: string
}

// 健康检查
export async function getHealth(): Promise<HealthInfo> {
  const { data } = await http.get('/health')
  return data
}

// 点云列表(已转换为 Potree 格式)
export async function listPointclouds(): Promise<PointCloudItem[]> {
  const { data } = await http.get('/pointclouds')
  return data.items
}

// 统一文件列表(raw + 转换状态)
export async function listFiles(): Promise<FileItem[]> {
  const { data } = await http.get('/files')
  return data.items
}

// 上传点云(自动转换)
export async function uploadPointcloud(
  file: File,
  autoConvert = true,
): Promise<{ saved: string; size: number; name: string; task_id: string | null }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await http.post('/pointclouds/upload', form, {
    params: { auto_convert: autoConvert },
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000,  // 上传大文件 5 分钟
  })
  return data
}

// 查询转换状态
export async function getConvertStatus(name: string): Promise<ConvertStatus> {
  const { data } = await http.get(`/pointclouds/${name}/status`)
  return data
}

// SSE 订阅转换进度(返回 EventSource,调用方负责关闭)
export function subscribeProgress(name: string, onMessage: (s: ConvertStatus) => void): EventSource {
  const es = new EventSource(`/api/pointclouds/${name}/progress`)
  es.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data))
    } catch (e) {
      console.error('SSE parse error:', e)
    }
  }
  return es
}

// 删除点云
export async function deletePointcloud(name: string): Promise<{ deleted: string[] }> {
  const { data } = await http.delete(`/pointclouds/${name}`)
  return data
}

// 下载点云文件(返回下载 URL,触发浏览器下载)
export function downloadUrl(name: string, which: 'pcd' | 'las' | 'laz' | 'ply' = 'pcd'): string {
  return `/api/pointclouds/${name}/download?which=${which}`
}

// 重命名
export async function renamePointcloud(name: string, newName: string) {
  const { data } = await http.post(`/pointclouds/${name}/rename`, { new_name: newName })
  return data
}

// LineString CRUD
export async function createLinestring(coords: number[], attrs?: Record<string, string>) {
  const { data } = await http.post('/linestrings', { coords, attrs })
  return data
}

export async function listLinestrings() {
  const { data } = await http.get('/linestrings')
  return data.items
}

// Lanelet CRUD
export async function createLanelet(leftId: number, rightId: number, attrs?: Record<string, string>) {
  const { data } = await http.post('/lanelets', { left_id: leftId, right_id: rightId, attrs })
  return data
}

export async function listLanelets() {
  const { data } = await http.get('/lanelets')
  return data.items
}

// 导出 OSM
export async function exportOsm(path = '/app/data/output.osm') {
  const { data } = await http.post('/export', null, { params: { path } })
  return data
}
