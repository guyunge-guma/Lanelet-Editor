# Lanelet Editor

> 基于 Potree + Lanelet2 的 Web 端高精地图矢量编辑器，专为自动驾驶仿真与规划场景设计。

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11+-green.svg)](https://www.python.org/)
[![Vue](https://img.shields.io/badge/vue-3.4+-green.svg)](https://vuejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](docker-compose.yml)

## 项目简介

Lanelet Editor 是一个 **浏览器端** 的 Lanelet2 矢量地图编辑工具，直接在 3D 点云上绘制车道线、组装 Lanelet、配置交通规则元素，并导出标准的 `.osm` 格式地图文件供 Autoware 等自动驾驶平台加载。

### 核心能力

- **点云可视化**：基于 Potree 1.8.2 的 LOD 八叉树渲染，支持 2-3GB 大场景点云流畅交互
- **PCD 自动转换**：上传 `.pcd` 文件自动转换为 Potree 格式（PCD → LAS → 八叉树）
- **LineString 绘制**：5 种类型（细线/虚线/粗线/护栏/虚拟线）× 多种子类型，支持碰撞检测
- **Lanelet 组装**：左右边界选择 + 方向 + 子类型，可视化面片 + 方向箭头
- **拓扑关系**：前驱/后继编辑，方向冲突校验
- **Regulatory Element**：红绿灯、停止线、减速带、交通标志 4 种类型
- **地图校验**：拓扑校验（孤立/断头/方向冲突/空间间隙）+ 几何校验（自相交/重叠/边界交叉）
- **自动吸附**：线段端点 / 中间点 / 点云表面（PCA 法向量估计）三级吸附
- **撤销/重做**：全局操作历史栈（Ctrl+Z / Ctrl+Y）
- **批量操作**：多选 LineString + 批量改类型 / 批量删除
- **地图持久化**：JSON 文件保存/加载，页面打开自动恢复
- **OSM 导入导出**：Lanelet2 标准 `.osm` 格式，UTM 投影 ↔ WGS84

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3.4 + TypeScript + Element Plus + Potree 1.8.2 + Three.js |
| 后端 | Python 3.11 + FastAPI + lanelet2 + PCL |
| 点云转换 | PotreeConverter（宿主机编译） |
| 部署 | Docker + Docker Compose |

## 快速开始

### 一键部署（推荐）

```bash
sudo chmod +x deploy.sh
sudo ./deploy.sh
```

脚本自动完成：Docker 安装 → 国内镜像源配置 → PotreeConverter 编译 → 镜像构建 → 服务启动 → 健康检查。

### 手动部署

```bash
# 1. 编译 PotreeConverter（宿主机）
cd third_party/PotreeConverter
mkdir build && cd build
cmake .. && make -j$(nproc)
sudo make install

# 2. 构建并启动
docker compose up -d --build

# 3. 访问
# 前端: http://localhost
# 后端 API: http://localhost:8000/api/health
```

详细部署说明请参阅 [DEPLOY.md](DEPLOY.md)。

## 使用流程

```
上传 PCD 点云 → 自动转换为 Potree 格式
      ↓
在 3D 点云上绘制 LineString（车道线、边界线）
      ↓
组装 Lanelet（选择左右边界 + 方向 + 子类型）
      ↓
设置拓扑关系（前驱/后继）
      ↓
创建 Regulatory Element（红绿灯、停止线等）
      ↓
校验（拓扑 + 几何）
      ↓
导出 OSM → 加载到 Autoware
```

## 项目结构

```
lanelet-editor/
├── frontend/           # Vue 3 前端
│   ├── src/
│   │   ├── views/MapView.vue       # 主视图（3D 场景 + 面板）
│   │   ├── components/             # 面板组件
│   │   │   ├── FileManager.vue     # 点云管理
│   │   │   ├── LineStringPanel.vue # 线段面板
│   │   │   ├── LaneletPanel.vue    # Lanelet 面板
│   │   │   └── RegulatoryPanel.vue # 交通元素面板
│   │   ├── utils/
│   │   │   └── DrawingManager.ts   # 绘制管理器（核心）
│   │   └── api/index.ts            # API 封装
│   └── Dockerfile
├── backend/            # Python FastAPI 后端
│   ├── app/
│   │   ├── main.py                 # FastAPI 入口
│   │   ├── lanelet2_service.py     # Lanelet2 核心服务
│   │   ├── converters.py           # PCD/LAS 转换
│   │   └── config.py               # 配置
│   └── Dockerfile
├── third_party/
│   └── PotreeConverter/           # 点云转换工具
├── docker-compose.yml
├── deploy.sh           # 一键部署脚本
└── DEPLOY.md           # 部署文档
```

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/pointclouds/upload` | 上传 PCD/LAS |
| GET | `/api/pointclouds` | 点云列表 |
| POST | `/api/linestrings` | 创建 LineString |
| GET | `/api/linestrings` | LineString 列表 |
| PUT | `/api/linestrings/{id}` | 更新 LineString |
| DELETE | `/api/linestrings/{id}` | 删除 LineString |
| POST | `/api/lanelets` | 创建 Lanelet |
| GET | `/api/lanelets` | Lanelet 列表 |
| PUT | `/api/lanelets/{id}/relations` | 设置拓扑关系 |
| POST | `/api/regulatory_elements` | 创建规则元素 |
| GET | `/api/regulatory_elements` | 规则元素列表 |
| POST | `/api/map/save` | 保存地图到 JSON |
| POST | `/api/map/load` | 从 JSON 加载地图 |
| POST | `/api/export` | 导出 OSM |
| GET | `/api/validate/topology` | 拓扑校验 |
| GET | `/api/validate/geometry` | 几何校验 |

## 校验规则

### 拓扑校验

| 类型 | 说明 | 严重级别 |
|------|------|----------|
| `isolated` | 孤立车道（无前驱无后继） | ⚠️ 警告 |
| `dangling` | 断头路（引用了不存在的 Lanelet） | ⚠️ 警告 |
| `direction_conflict` | 方向冲突（前驱/后继关系不对称） | 🔴 错误 |
| `gap` | 空间间隙（无拓扑关系但端点距离 < 5m） | ⚠️ 警告 |

### 几何校验

| 类型 | 说明 | 严重级别 |
|------|------|----------|
| `self_intersect` | LineString 自相交 | ⚠️ 警告 |
| `overlap` | 两条 LineString 距离过近（< 0.05m） | 🔴 错误 |
| `boundary_cross` | Lanelet 左右边界交叉 | 🔴 错误 |

## 配置

环境变量（`backend/.env`）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATA_DIR` | `/app/data` | 数据目录 |
| `MAP_FILE` | `data/map.json` | 默认地图文件 |
| `POTREE_CONVERTER_PATH` | `/opt/potreeconverter` | PotreeConverter 路径 |
| `ORIGIN_LAT` | `30.0` | 原点纬度（UTM 投影） |
| `ORIGIN_LON` | `120.0` | 原点经度（UTM 投影） |

## 开发

```bash
# 前端开发
cd frontend
npm install
npm run dev

# 后端开发
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## License

Apache-2.0

## 致谢

- [Potree](https://github.com/potree/potree) - WebGL 点云渲染
- [Lanelet2](https://github.com/fzi-forschungszentrum-informatik/Lanelet2) - 自动驾驶地图库
- [Three.js](https://threejs.org/) - 3D 图形库
- [Element Plus](https://element-plus.org/) - Vue 3 UI 组件库
