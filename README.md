<div align="center">

# Lanelet Editor

**Web-based Lanelet2 HD Map Editor**

基于 Potree + FastAPI 的私有化部署 Web 端 Lanelet2 高精地图编辑器

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11-blue)](backend/requirements.txt)
[![Vue](https://img.shields.io/badge/Vue-3.5-4fc08d)](frontend/package.json)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688)](backend/requirements.txt)

</div>

---

## Overview

Lanelet Editor 是一个运行在浏览器中的 **Lanelet2 高精地图编辑工具**，支持在三维点云上直接绘制和编辑 HD 地图。对标 Tier IV 的 Vector Map Builder（仅 SaaS 且非开源），本项目的目标是提供一个 **私有化部署**、**开源免费** 的替代方案。

### Use Cases

- 自动驾驶高精地图标注与编辑
- Lanelet2 格式地图的创建、校验与导出
- Autoware 等自动驾驶框架的地图数据准备
- 点云采集数据的可视化与标注

---

## Features

| 功能 | 说明 |
|------|------|
| **点云渲染** | 基于 Potree 的 WebGL 点云可视化，支持亿级点云流畅浏览 |
| **点云上传转换** | PCD/LAS 文件上传 → 自动 PotreeConverter 转换 → 增量加载 |
| **LineString 编辑** | 在点云上拾取坐标绘制线段，支持自动吸附、撤销/重做 |
| **Lanelet 编辑** | 左右边界关联，方向设置，拓扑关系（前驱/后继）管理 |
| **交通要素** | 红绿灯、停止线、人行横道、交通标志的创建与管理 |
| **OSM 导入导出** | 与标准 Lanelet2 .osm 格式互通 |
| **地图校验** | 拓扑校验（孤立车道、断头路）+ 几何校验（重叠、自相交） |
| **持久化** | JSON 格式保存/加载，重启不丢失 |
| **一键部署** | Docker Compose 前后端容器化部署 |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  Potree  │  │  Vue 3   │  │  Element Plus    │   │
│  │ (点云渲染) │  │  (框架)   │  │  (UI 组件)        │   │
│  └────┬─────┘  └────┬─────┘  └──────────────────┘   │
│       │             │                                │
└───────┼─────────────┼────────────────────────────────┘
        │             │
        │  /pointclouds/* (静态文件)   /api/* (REST)
        ▼             ▼
┌─────────────────────────────────────────────────────┐
│                   nginx (反向代理)                    │
└─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────┐
│              FastAPI (uvicorn)                       │
│  ┌──────────────────────────────────────────────┐   │
│  │  Lanelet2 Service                            │   │
│  │  ├── LineString / Lanelet CRUD               │   │
│  │  ├── Regulatory Element 管理                  │   │
│  │  ├── OSM 导入/导出                             │   │
│  │  └── 拓扑/几何校验                              │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │  Point Cloud Pipeline                        │   │
│  │  ├── PCD → LAS 转换                          │   │
│  │  └── PotreeConverter 调用                     │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────┐
│                    Data Volume                       │
│  data/                                              │
│  ├── raw/              原始 PCD/LAS 文件             │
│  ├── pointclouds/      Potree 转换输出               │
│  ├── exports/          导出的 .osm 文件               │
│  └── map.json          地图持久化文件                  │
└─────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- 8 GB+ RAM (推荐 16 GB 用于大点云)
- NVIDIA GPU (可选，用于加速点云渲染)

### Start Services

```bash
# 一键构建并启动
./start.sh

# 或手动
docker compose up -d --build
```

### Verify

| Service | URL |
|---------|-----|
| Frontend | http://localhost:8080 |
| Backend Health | http://localhost:8000/api/health |

健康检查应返回:
```json
{
  "status": "ok",
  "lanelet2_available": true,
  "origin": {"lat": 31.2304, "lon": 121.4737}
}
```

### Load Point Cloud

```bash
# 1) 把 PCD 文件放到 data/raw/
cp ~/road.pcd data/raw/

# 2) 用 PotreeConverter 转换
./convert_pointcloud.sh data/raw/road.pcd road_map

# 3) 前端页面点击"刷新"即可看到 road_map
```

---

## Configuration

### Lanelet2 Origin

编辑 `docker-compose.yml`:

```yaml
environment:
  - ORIGIN_LAT=31.2304    # 采集点纬度
  - ORIGIN_LON=121.4737   # 采集点经度
```

> **原点必须与 PCD 采集点的 WGS84 坐标一致**，否则导出的 OSM 坐标会偏移。

### Data Directory

```
data/
├── raw/                 # 上传的原始 PCD/LAS 文件
├── pointclouds/         # PotreeConverter 输出
│   └── road_map/
│       ├── metadata.json
│       └── ...
├── exports/             # 导出的 .osm 文件
└── map.json             # 地图持久化文件
```

---

## Development

### Backend

```bash
cd backend
conda create -n lanelet-editor python=3.11 -y
conda activate lanelet-editor
conda install -c conda-forge lanelet2
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# 访问 http://localhost:5173
```

### Build PotreeConverter

```bash
./build_potreeconverter.sh
```

---

## API Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | 健康检查 + 依赖状态 |
| GET/POST | `/api/linestrings` | 列出 / 创建 LineString |
| GET/PUT/DELETE | `/api/linestrings/{id}` | 单个 LineString CRUD |
| GET/POST | `/api/lanelets` | 列出 / 创建 Lanelet |
| GET/PUT/DELETE | `/api/lanelets/{id}` | 单个 Lanelet CRUD |
| PUT/GET | `/api/lanelets/{id}/relations` | 拓扑关系管理 |
| GET | `/api/lanelets/relations` | 所有 Lanelet 拓扑关系 |
| GET | `/api/lanelets/geometry` | 所有 Lanelet 几何数据 |
| POST | `/api/regulatory_elements` | 创建 Regulatory Element |
| POST | `/api/traffic_lights` | 创建红绿灯 |
| POST | `/api/stop_lines` | 创建停止线 |
| GET | `/api/validate/topology` | 拓扑校验 |
| GET | `/api/validate/geometry` | 几何校验 |
| POST | `/api/export` | 导出 .osm |
| POST | `/api/import` | 导入 .osm |
| POST | `/api/map/save` | 保存地图 JSON |
| POST | `/api/map/load` | 加载地图 JSON |
| POST | `/api/pointclouds/upload` | 上传点云文件 |
| GET | `/api/pointclouds` | 列出点云 |

完整 API 文档见 `http://localhost:8000/docs` (Swagger UI)。

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Point Cloud Rendering | Potree 1.8.2 (Three.js) |
| Frontend Framework | Vue 3 + Vite + TypeScript |
| UI Library | Element Plus |
| Backend | FastAPI (Python 3.11) |
| Map Library | lanelet2 (conda-forge) |
| Point Cloud Converter | PotreeConverter 2.1.3 |
| Deployment | Docker Compose (nginx + uvicorn) |

---

## Roadmap

- [x] 点云可视化 + 文件管理
- [x] LineString / Lanelet CRUD
- [x] OSM 导入导出
- [x] 交通要素编辑
- [x] 拓扑/几何校验
- [x] 撤销/重做
- [x] 点云吸附、批量操作
- [x] 持久化保存/加载
- [ ] 多用户协作
- [ ] 自定义地图图层样式
- [ ] 更丰富的校验规则
- [ ] 性能优化（大点云 LOD）

---

## FAQ

### Q: lanelet2_available 为什么是 false?

lanelet2 是 C++ 绑定库，在某些环境编译失败。后端会以降级模式启动，点云功能正常但 Lanelet2 操作不可用。

修复:
```bash
docker compose exec backend conda install -c conda-forge lanelet2
docker compose restart backend
```

### Q: 点云加载失败 404?

检查 `data/pointclouds/<name>/metadata.json` 是否存在。必须用 PotreeConverter 转换后才能加载。

### Q: Windows 下 PowerShell 跑 start.sh 报错?

用 Git Bash 或 WSL 执行，或直接 `docker compose up -d --build`。

---

## License

[MIT](LICENSE)

## Contributors

欢迎贡献！请阅读 [CONTRIBUTING](CONTRIBUTING.md) 了解如何参与开发。
