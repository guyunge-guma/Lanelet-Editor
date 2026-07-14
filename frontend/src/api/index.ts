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
}

export interface PointCloudItem {
  name: string
  url: string
}

// 健康检查
export async function getHealth(): Promise<HealthInfo> {
  const { data } = await http.get('/health')
  return data
}

// 点云列表
export async function listPointclouds(): Promise<PointCloudItem[]> {
  const { data } = await http.get('/pointclouds')
  return data.items
}

// 上传点云
export async function uploadPointcloud(file: File): Promise<{ saved: string; size: number }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await http.post('/pointclouds/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
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
