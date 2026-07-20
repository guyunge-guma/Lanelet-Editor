import axios from 'axios'

const http = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

// 统一错误处理:提取后端 detail,简化组件层代码
http.interceptors.response.use(
  (response) => response,
  (error) => {
    let message = '网络异常,请检查后端服务'
    if (error.response) {
      const status = error.response.status
      const detail = error.response.data?.detail || error.response.data?.message
      if (detail) {
        message = detail
      } else if (status === 404) {
        message = '请求的资源不存在(404)'
      } else if (status === 413) {
        message = '文件过大(413)'
      } else if (status === 415) {
        message = '不支持的格式(415)'
      } else if (status >= 500) {
        message = `后端服务错误(${status})`
      } else if (status === 401 || status === 403) {
        message = '权限不足'
      }
    } else if (error.code === 'ECONNABORTED') {
      message = '请求超时,请重试或检查网络'
    } else if (!window.navigator.onLine) {
      message = '网络已断开,请检查网络连接'
    }
    return Promise.reject(new Error(message))
  }
)

export interface HealthInfo {
  status: string
  lanelet2_available: boolean
  origin: { lat: number; lon: number; alt: number }
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
  const { data } = await http.post(`/pointclouds/${name}/convert`, undefined, { timeout: 120000 })
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

// ---------------- 拓扑关系自动建议 ----------------

/** 拓扑连接建议项 */
export interface TopologySuggestion {
  from_id: number
  to_id: number
  distance: number
  relation: string
  message: string
}

/** 自动建议 Lanelet 之间的前驱/后继关系 */
export async function suggestTopology(maxDistance: number = 5.0): Promise<TopologySuggestion[]> {
  const { data } = await http.get('/lanelets/suggest_topology', { params: { max_distance: maxDistance } })
  return data.suggestions
}

/** 批量应用拓扑建议 */
export async function applyTopologySuggestions(
  suggestions: TopologySuggestion[],
): Promise<{ applied: number; failed: number }> {
  const { data } = await http.post('/lanelets/apply_suggestions', { suggestions })
  return data
}

// ---------------- LineString 扩展 CRUD ----------------

/** LineString 完整数据(含坐标与属性) */
export interface LineStringItem {
  id: number
  coords: number[]
  attrs: Record<string, string>
}

/**
 * 更新指定 LineString 的坐标 / 属性
 * @param id LineString 后端 id
 * @param coords 新坐标(仅改属性时传 undefined)
 * @param attrs 新属性(仅改坐标时传 undefined)
 */
export async function updateLinestring(
  id: number,
  coords?: number[],
  attrs?: Record<string, string>,
) {
  const payload: Record<string, unknown> = {}
  if (coords !== undefined) payload.coords = coords
  if (attrs !== undefined) payload.attrs = attrs
  const { data } = await http.put(`/linestrings/${id}`, payload)
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

/** 保存当前所有标注到默认地图文件(新 API,含 RE) */
export async function saveMapAll(): Promise<{ path: string; linestring_count: number; lanelet_count: number; message: string }> {
  const { data } = await http.post('/map/save', undefined, { timeout: 120000 })
  return data
}

/** 从默认地图文件加载所有标注(新 API,含 RE) */
export async function loadMapAll(): Promise<{ path: string; linestring_count: number; lanelet_count: number }> {
  const { data } = await http.post('/map/load', undefined, { timeout: 120000 })
  return data
}

/** 获取当前地图状态 */
export async function getMapInfo(): Promise<{ map_exists: boolean; linestring_count: number; lanelet_count: number; map_file: string }> {
  const { data } = await http.get('/map/health')
  return data
}

/** 清空所有 LineString */
export async function clearLinestrings() {
  const { data } = await http.delete('/linestrings')
  return data
}

// ---------------- OSM 导入 / 导出 ----------------

/** 导出结果 */
export interface ExportResult {
  path: string
  filename: string
  size: number
  download_url: string
}

/** 导入统计 */
export interface ImportStats {
  linestring_count: number
  lanelet_count: number
  regulatory_count: number
}

/** 导出当前地图为 Lanelet2 .osm 文件
 * path 为空时后端默认输出到 data/exports/map_<timestamp>.osm
 */
export async function exportOsm(path?: string): Promise<ExportResult> {
  const { data } = await http.post('/export', { path }, { timeout: 120000 })
  return data
}

/** 导入 .osm 文件(会清空当前地图后重建) */
export async function importOsm(path: string): Promise<ImportStats> {
  const { data } = await http.post('/import', { path }, { timeout: 120000 })
  return data
}

/** 构造导出文件下载 URL(配合 exportOsm 返回的 filename 使用) */
export function exportDownloadUrl(filename: string): string {
  return `/api/export/download/${filename}`
}

/** 触发浏览器下载(创建临时 <a> 标签并点击) */
export function triggerDownload(url: string, filename?: string): void {
  const a = document.createElement('a')
  a.href = url
  if (filename) a.download = filename
  a.click()
}

// ---------------- 校验: 拓扑 / 几何 ----------------

export interface TopologyIssue {
  type: 'isolated' | 'dangling' | 'direction_conflict'
  lanelet_id: number
  message: string
}

export interface GeometryIssue {
  type: 'overlap' | 'self_intersect' | 'boundary_cross'
  id: number
  message: string
}

/** 拓扑校验(孤立车道 / 断头路 / 方向冲突) */
export async function validateTopology(): Promise<TopologyIssue[]> {
  const { data } = await http.get('/validate/topology')
  return data.items
}

/** 几何校验(LineString 重叠 / 自相交 / Lanelet 左右边界交叉) */
export async function validateGeometry(): Promise<GeometryIssue[]> {
  const { data } = await http.get('/validate/geometry')
  return data.items
}

// ---------------- 坐标系原点配置 ----------------

/** 投影器类型字面量 */
export type ProjectorType = 'utm' | 'mgrs'

export interface OriginConfig {
  lat: number
  lon: number
  alt: number
  /** 当前投影器类型:'utm' 或 'mgrs' */
  projector_type: ProjectorType | string
  /** 当前 lanelet2 版本是否支持 MGRS 投影(不支持时前端应禁用 mgrs 选项) */
  mgrs_available: boolean
}

/** 获取当前投影原点与投影器类型 */
export async function getOrigin(): Promise<OriginConfig> {
  const { data } = await http.get('/config/origin')
  return data
}

/** 获取当前投影原点与投影器类型(语义别名) */
export async function getOriginConfig(): Promise<OriginConfig> {
  return getOrigin()
}

/** 设置投影原点(WGS84 经纬度 + 高程),可选切换 projector 类型 */
export async function setOrigin(
  lat: number,
  lon: number,
  alt = 0,
  projectorType?: ProjectorType | string,
): Promise<OriginConfig> {
  const payload: Record<string, unknown> = { lat, lon, alt }
  if (projectorType !== undefined) payload.projector_type = projectorType
  const { data } = await http.put('/config/origin', payload)
  return data
}

/** 设置投影配置(部分字段,未提供的字段保持不变) */
export async function setOriginConfig(config: Partial<OriginConfig>): Promise<OriginConfig> {
  const payload: Record<string, unknown> = {}
  if (config.lat !== undefined) payload.lat = config.lat
  if (config.lon !== undefined) payload.lon = config.lon
  if (config.alt !== undefined) payload.alt = config.alt
  if (config.projector_type !== undefined) payload.projector_type = config.projector_type
  const { data } = await http.put('/config/origin', payload)
  return data
}

// ============================================================
//  Regulatory Element API(交通规则元素)
// ============================================================

/** Regulatory Element 类型 */
export type RegulatoryElementType =
  | 'traffic_light'
  | 'stop_line'
  | 'crosswalk'
  | 'traffic_sign'
  | 'parking'
  | 'pedestrian'
  | 'priority'

/** Regulatory Element 数据结构 */
export interface RegulatoryElement {
  id: number
  /** 元素类型:traffic_light / stop_line / crosswalk / traffic_sign / parking / pedestrian / priority */
  type: RegulatoryElementType | string
  /** 关联的 Lanelet id 列表 */
  lanelet_ids: number[]
  /** 附加属性(如 sign_type / state / color 等) */
  attrs: Record<string, string>
}

/** 创建 Regulatory Element */
export async function createRegulatoryElement(
  type: string,
  lanelet_ids: number[],
  attrs: Record<string, string> = {},
): Promise<RegulatoryElement> {
  const { data } = await http.post('/regulatory_elements', {
    type,
    lanelet_ids,
    attrs,
  })
  return data
}

/** 列出所有 Regulatory Element */
export async function listRegulatoryElements(): Promise<RegulatoryElement[]> {
  const { data } = await http.get('/regulatory_elements')
  return data.items
}

/** 获取单个 Regulatory Element */
export async function getRegulatoryElement(id: number): Promise<RegulatoryElement> {
  const { data } = await http.get(`/regulatory_elements/${id}`)
  return data
}

/** 更新 Regulatory Element */
export async function updateRegulatoryElement(
  id: number,
  payload: {
    type?: string
    lanelet_ids?: number[]
    attrs?: Record<string, string>
  },
): Promise<RegulatoryElement> {
  const { data } = await http.put(`/regulatory_elements/${id}`, payload)
  return data
}

/** 删除 Regulatory Element */
export async function deleteRegulatoryElement(id: number) {
  const { data } = await http.delete(`/regulatory_elements/${id}`)
  return data
}

// ============================================================
//  Traffic Light API(红绿灯)
// ============================================================

/** 红绿灯数据结构 */
export interface TrafficLight {
  id: number
  /** 世界坐标 [x, y, z] */
  position: [number, number, number]
  /** 朝向(欧拉角,弧度)[x, y, z] */
  orientation: [number, number, number]
  /** 关联的 Lanelet id(可空) */
  lanelet_id: number | null
  /** 附加属性(state / color 等) */
  attrs: Record<string, string>
}

/** 创建红绿灯 */
export async function createTrafficLight(
  position: [number, number, number],
  orientation: [number, number, number] = [0, 0, 0],
  lanelet_id: number | null = null,
  attrs: Record<string, string> = {},
): Promise<TrafficLight> {
  const { data } = await http.post('/traffic_lights', {
    position,
    orientation,
    lanelet_id,
    attrs,
  })
  return data
}

/** 列出所有红绿灯 */
export async function listTrafficLights(): Promise<TrafficLight[]> {
  const { data } = await http.get('/traffic_lights')
  return data.items
}

/** 删除红绿灯 */
export async function deleteTrafficLight(id: number) {
  const { data } = await http.delete(`/traffic_lights/${id}`)
  return data
}

// ============================================================
//  Stop Line API(停止线)
// ============================================================

/** 停止线数据结构 */
export interface StopLine {
  id: number
  /** 构成停止线的 LineString id */
  linestring_id: number
  /** 关联的 Lanelet id */
  lanelet_id: number
  /** 关联的红绿灯 id(可空) */
  traffic_light_id: number | null
  attrs: Record<string, string>
}

/** 创建停止线 */
export async function createStopLine(
  linestring_id: number,
  lanelet_id: number,
  traffic_light_id: number | null = null,
): Promise<StopLine> {
  const { data } = await http.post('/stop_lines', {
    linestring_id,
    lanelet_id,
    traffic_light_id,
  })
  return data
}

/** 列出所有停止线 */
export async function listStopLines(): Promise<StopLine[]> {
  const { data } = await http.get('/stop_lines')
  return data.items
}

/** 删除停止线 */
export async function deleteStopLine(id: number) {
  const { data } = await http.delete(`/stop_lines/${id}`)
  return data
}

/**
 * 根据车道方向生成与车道垂直的停止线坐标
 * @param laneletId 关联的车道 ID
 * @param offset 沿车道方向的偏移量(米),正值向车道终点方向
 * @param width 停止线宽度(米),留空则自动取车道宽度
 * @returns [x1, y1, z1, x2, y2, z2] 两个端点的坐标
 */
export async function generateStopLine(
  laneletId: number,
  offset: number = 0,
  width?: number,
): Promise<number[]> {
  const { data } = await http.post(`/lanelets/${laneletId}/generate_stop_line`, {
    lanelet_id: laneletId,
    offset,
    width,
  })
  return data.coords
}

// 注:导出/导入/校验/原点 API 见本文件上方已定义的
// exportOsm / importOsm / exportDownloadUrl / validateTopology / validateGeometry / getOrigin / setOrigin
