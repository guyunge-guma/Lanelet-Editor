# Lanelet Editor

Web 端 Lanelet2 高精地图编辑器,基于 Potree + FastAPI + lanelet2。

## 架构

```
浏览器 (Vue3 + Potree)
    ↓ REST / 点云 HTTP
后端 (FastAPI + lanelet2 Python)
    ↓
持久化卷 ./data
```

## 快速开始

### 1. 启动服务

```bash
# 一键构建并启动
./start.sh

# 或手动
docker compose up -d --build
```

### 2. 验证

- 前端: http://localhost:8080
- 后端健康检查: http://localhost:8000/api/health

健康检查应返回:
```json
{
  "status": "ok",
  "lanelet2_available": true,
  "origin": {"lat": 31.2304, "lon": 121.4737}
}
```

### 3. 加载点云

```bash
# 1) 把你的 PCD 文件放到 data/raw/
cp ~/road.pcd data/raw/

# 2) 用 PotreeConverter 转换
./convert_pointcloud.sh data/raw/road.pcd road_map

# 3) 前端页面点"刷新"即可看到 road_map
```

## 配置说明

### 修改 Lanelet2 原点

编辑 `docker-compose.yml` 中 backend 服务的环境变量:

```yaml
environment:
  - ORIGIN_LAT=31.2304    # 你的采集点纬度
  - ORIGIN_LON=121.4737   # 你的采集点经度
```

**原点必须与 PCD 采集点的 WGS84 坐标一致**,否则导出的 OSM 坐标会偏移。

### 数据目录结构

```
data/
├── raw/                 # 上传的原始 PCD 文件
├── pointclouds/         # PotreeConverter 输出
│   └── road_map/
│       ├── metadata.json
│       └── ...
└── output.osm           # 导出的 Lanelet2 地图
```

## 开发模式

### 后端本地开发

```bash
cd backend
conda create -n lanelet-editor python=3.11 -y
conda activate lanelet-editor
conda install -c conda-forge lanelet2
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 前端本地开发

```bash
cd frontend
npm install
npm run dev
# 访问 http://localhost:5173
```

## 当前状态(第 1 轮)

✅ 已完成:
- [x] 后端 FastAPI 脚手架
- [x] lanelet2 服务封装(Point/LineString/Lanelet CRUD)
- [x] OSM 导入导出接口
- [x] 点云文件管理(上传 + 列表)
- [x] 前端 Potree 渲染
- [x] Docker Compose 一键部署

🔜 第 2 轮计划:
- [ ] 点云拾取坐标
- [ ] LineString 绘制交互
- [ ] Lanelet 组装(左右边界关联)
- [ ] 元素持久化(刷新页面后回显)

## 技术栈

| 层 | 选型 |
|----|------|
| 点云渲染 | Potree + Three.js |
| 前端框架 | Vue 3 + Vite + Element Plus |
| 后端 | FastAPI (Python 3.11) |
| 地图库 | lanelet2 (conda-forge) |
| 部署 | Docker Compose |

## 常见问题

### Q: lanelet2_available 为什么是 false?

lanelet2 是 C++ 绑定库,在某些环境编译失败。后端会以降级模式启动,点云功能正常但 Lanelet2 操作不可用。

修复:
```bash
docker compose exec backend conda install -c conda-forge lanelet2
docker compose restart backend
```

### Q: 点云加载失败 404?

检查 `data/pointclouds/<name>/metadata.json` 是否存在。必须用 `convert_pointcloud.sh` 转换后才能被前端加载。

### Q: Windows 下 PowerShell 跑 start.sh 报错?

用 Git Bash 或 WSL 执行,或直接 `docker compose up -d --build`。
