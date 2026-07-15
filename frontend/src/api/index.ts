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

// 手动触发转换(无需重新上传)
export async function convertPointcloud(name: string): Promise<{ task_id: string; name: string; message: string }> {
  const { data } = await http.post(`/pointclouds/${name}/convert`)
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

// ---------------- Lanelet 扩展 CRUD ----------------

/** Lanelet 列表项(不含坐标) */
export interface LaneletItem {
  id: number
  left_id: number
  right_id: number
  attrs: Record<string, string>
}

/** Lanelet 几何数据(含左右边界坐标,用于前端可视化) */
export interface LaneletGeometry {
  id: number
  left_coords: number[]
  right_coords: number[]
  attrs: Record<string, string>
}

/** Lanelet 拓扑关系 */
export interface LaneletRelations {
  id: number
  predecessor: number[]
  successor: number[]
}

/** 获取单个 Lanelet(含左右边界坐标) */
export async function getLanelet(
  id: number,
): Promise<LaneletItem & { left_coords: number[]; right_coords: number[] }> {
  const { data } = await http.get(`/lanelets/${id}`)
  return data
}

/** 更新 Lanelet 的左右边界或属性 */
export async function updateLanelet(
  id: number,
  data: { left_id?: number; right_id?: number; attrs?: Record<string, string> },
) {
  const res = await http.put(`/lanelets/${id}`, data)
  return res.data
}

/** 删除单个 Lanelet */
export async function deleteLanelet(id: number) {
  const { data } = await http.delete(`/lanelets/${id}`)
  return data
}

/** 获取单个 Lanelet 的几何数据(左右边界坐标) */
export async function getLaneletGeometry(id: number): Promise<LaneletGeometry> {
  const { data } = await http.get(`/lanelets/${id}/geometry`)
  return data
}

/** 列出所有 Lanelet 的几何数据(一次拉取,用于前端批量可视化) */
export async function listLaneletsWithGeometry(): Promise<LaneletGeometry[]> {
  const { data } = await http.get('/lanelets/geometry')
  return data.items
}

/** 设置 Lanelet 的前驱/后继关系 */
export async function setLaneletRelations(
  id: number,
  predecessor: number[],
  successor: number[],
) {
  const { data } = await http.put(`/lanelets/${id}/relations`, { predecessor, successor })
  return data
}

/** 获取单个 Lanelet 的前驱/后继关系 */
export async function getLaneletRelations(id: number): Promise<LaneletRelations> {
  const { data } = await http.get(`/lanelets/${id}/relations`)
  return data
}

/** 获取所有 Lanelet 的拓扑关系(用于关系编辑时的候选列表) */
export async function getAllLaneletRelations(): Promise<LaneletRelations[]> {
  const { data } = await http.get('/lanelets/relations')
  return data.items
}

// ---------------- LineString 扩展 CRUD ----------------

/** LineString 完整数据(含坐标与属性) */
export interface LineStringItem {
  id: number
  coords: number[]
  attrs: Record<string, string>
}

/** 更新指定 LineString 的坐标 / 属性 */
export async function updateLinestring(
  id: number,
  coords: number[],
  attrs?: Record<string, string>,
) {
  const { data } = await http.put(`/linestrings/${id}`, { coords, attrs })
  return data
}

/** 删除指定 LineString */
export async function deleteLinestring(id: number) {
  const { data } = await http.delete(`/linestrings/${id}`)
  return data
}

/** 获取单条 LineString */
export async function getLinestring(id: number): Promise<LineStringItem> {
  const { data } = await http.get(`/linestrings/${id}`)
  return data
}

/** 保存当前地图到 JSON 文件(默认后端路径) */
export async function saveMap(path?: string) {
  const { data } = await http.post('/linestrings/save', { path })
  return data
}

/** 从 JSON 文件加载地图(默认后端路径) */
export async function loadMap(path?: string) {
  const { data } = await http.post('/linestrings/load', { path })
  return data
}

/** 清空所有 LineString */
export async function clearLinestrings() {
  const { data } = await http.delete('/linestrings')
  return data
}

// 导出 OSM
export async function exportOsm(path = '/app/data/output.osm') {
  const { data } = await http.post('/export', null, { params: { path } })
  return data
}
