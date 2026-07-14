# Lanelet Editor - 项目进度与开发计划

> 基于 Potree + lanelet2 的私有化部署 Web 端 Lanelet2 矢量地图编辑器
>
> 最后更新: 2026-07-14

---

## 一、项目背景

### 1.1 需求
- **核心目标**: 私有化部署的 Web 端点云可视化 + Lanelet2 矢量地图编辑工具
- **目标格式**: Lanelet2 (.osm)
- **替代方案**: 对标 Tier IV 的 Vector Map Builder(仅 SaaS,非开源)
- **部署环境**: 8核 16GB 300GB HDD 服务器(CentOS Stream 10 / RHEL 10)

### 1.2 技术选型
| 层 | 选型 | 理由 |
|----|------|------|
| 点云渲染 | Potree 1.8.2 | 开源 BSD,WebGL,亿级点流畅 |
| 前端框架 | Vue3 + Vite + TypeScript | 现代化生态 |
| UI 组件 | Element Plus | 快速搭建管理界面 |
| 后端 | FastAPI (Python 3.11) | 异步、自动 OpenAPI |
| Lanelet2 | lanelet2 Python 绑定 | 官方维护 |
| 点云转换 | PotreeConverter 2.1.3(编译安装) | PCD/LAS → Potree 八叉树 |
| 部署 | Docker Compose | 前端 nginx + 后端 uvicorn |

### 1.3 架构
```
浏览器 (Vue3 + Potree)
   │ REST + 静态文件
   ▼
nginx (反向代理) ── /pointclouds/* ── 静态文件
   │ /api/*
   ▼
FastAPI (uvicorn)
   ├── lanelet2 Python 库
   └── subprocess 调用 PotreeConverter
```

---

## 二、当前工作进展

### 2.1 第 1 轮交付物(已完成)

#### 后端 (`backend/`)
- ✅ FastAPI 应用入口 (`app/main.py`)
- ✅ lanelet2 服务封装 (`app/lanelet2_service.py`)
- ✅ 配置管理 (`app/config.py`)
- ✅ 健康检查接口 `/api/health` — 返回 `lanelet2_available: true`
- ✅ 点云列表接口 `/api/pointclouds`
- ✅ 点云上传接口 `/api/pointclouds/upload`
- ✅ Dockerfile (基于 `python:3.11-slim`,pip 安装 lanelet2 wheel)

#### 前端 (`frontend/`)
- ✅ Vue3 + Vite + TypeScript 脚手架
- ✅ Potree 1.8.2 预构建文件集成(通过 Dockerfile COPY zip 解压)
- ✅ Element Plus UI(侧栏 + 状态栏)
- ✅ 点云列表 + 上传组件
- ✅ Potree Viewer 初始化(含错误提示)
- ✅ Dockerfile (多阶段构建 → nginx)

#### 部署脚本
- ✅ `docker-compose.yml` — 一键编排
- ✅ `start.sh` — 构建/启动/停止/日志
- ✅ `build_potreeconverter.sh` — 从源码编译 PotreeConverter 2.1.3
- ✅ `convert_pointcloud.sh` — 点云转换脚本
- ✅ `pcd2las.py` — Python PCD → LAS 转换器(纯 pip 依赖)

### 2.2 验证结果

| 检查项 | 结果 |
|--------|------|
| `docker compose ps` | ✅ lanelet-backend / lanelet-frontend 都 Up |
| `curl /api/health` | ✅ `{"status":"ok","lanelet2_available":true,...}` |
| `curl /api/pointclouds` | ✅ 返回 industrial_area |
| `curl -I /pointclouds/.../metadata.json` | ✅ HTTP 200 |
| PotreeConverter 编译 | ✅ `/opt/potreeconverter/PotreeConverter` 可用 |
| PCD → LAS 转换 | ✅ 2596415 点,坐标范围正常 |
| LAS → Potree 转换 | ✅ 生成 metadata.json + octree.bin + hierarchy.bin |

---

## 三、已遇到并解决的问题

### 3.1 Docker / 网络类

| # | 问题 | 原因 | 解决 |
|---|------|------|------|
| 1 | 镜像拉取 429 | `daemon.json` 中 URL 带反引号 | 删除反引号,启用国内镜像源 |
| 2 | `miniconda3:25.3.1-0` tag 不存在 | 版本号写死 | 改用 `miniconda3:latest` |
| 3 | apt 源找不到 `sources.list` | Debian 12 用 deb822 新格式 | 移除 apt 步骤(改用 pip 装 lanelet2) |
| 4 | npm `potree` 包是空壳 | npm 上不发布真 Potree | 从 GitHub Release 1.8.2 下载 zip,用 `gh-proxy.org` 加速 |
| 5 | pip 下载超时 | 走默认 pypi | 配置清华源 `pip install -i https://pypi.tuna.tsinghua.edu.cn/simple` |

### 3.2 依赖解析类

| # | 问题 | 原因 | 解决 |
|---|------|------|------|
| 6 | `conda install lanelet2` 卡 5+ 分钟 | classic solver 慢 + 4 个 channel 各下 repodata | 改用 `python:3.11-slim` + pip 安装预编译 wheel |
| 7 | PDAL 安装后 `symbol lookup error` | RHEL 10 上 libgeotiff 版本冲突 | 弃用 PDAL,自写 `pcd2las.py` |

### 3.3 PCD 处理类

| # | 问题 | 原因 | 解决 |
|---|------|------|------|
| 8 | PotreeConverter 直接转 PCD 失败 (`#points: 0`) | PCD 字段顺序异常:`curvature/intensity/rgb/normal/x/y/z`,x/y/z 在最后 | 写 `pcd2las.py` 用 numpy structured dtype 按 offset 精确读取 |
| 9 | `numpy.frombuffer strides 参数不支持` | numpy 2.x API 变更 | 改用 structured dtype 一次性读全 |

### 3.4 前端加载类

| # | 问题 | 原因 | 解决 |
|---|------|------|------|
| 10 | `jquery-3.6.0.min.js` 404 返回 HTML | Potree 1.8.2 自带的是 3.1.1 | 改 index.html 引用 `jquery-3.1.1.min.js` |
| 11 | `proj4 is not defined` | 未加载 proj4 依赖 | 加 `/libs/proj4/proj4.js` |
| 12 | `t.Viewer is not a constructor` | jQuery/proj4 失败导致 Potree 初始化失败 | 修复依赖加载顺序后自动解决 |
| 13 | `three.min.js` 404 | three.js 目录下没有 three.min.js | 移除,Potree 自带 three.module.js |
| 14 | `BinaryHeap is not defined` | 可见性计算依赖未加载 | 加 `/libs/other/BinaryHeap.js` |
| 15 | `TWEEN is not defined` | 相机动画依赖未加载 | 加 `/libs/tween/tween.min.js` |
| 16 | `Cannot find module '../components/FileManager.vue'` | vue-tsc 2.x 在 build 模式下不识别 `*.vue` 模块声明 | build 脚本去掉 `vue-tsc -b`,改为 `vite build`;类型检查单独用 `npm run typecheck` |
| 17 | `Element is missing end tag (FileManager.vue:65)` | `el-dropdown` 的 `#dropdown` template 写成两个 `</el-dropdown>` 闭合 | 改为 `</template></el-dropdown>` |
| 18 | `PotreeConverter: liblaszip.so: cannot open shared object file` | 宿主机编译的 laszip 动态库装到 `/usr/local/lib`,未挂载到容器 | ① 宿主机复制 `liblaszip.so` 到 `/opt/potreeconverter/lib/` ② 后端 Dockerfile 加 `LD_LIBRARY_PATH=/opt/potreeconverter/lib` |

---

## 四、当前阻塞点

### 4.1 前端 Potree 依赖加载顺序问题
**状态**: 已定位,修复方案已出,待重新构建验证

`index.html` 中依赖加载顺序应为:
1. `jquery-3.1.1.min.js` (Potree UI 依赖)
2. `proj4.js` (坐标投影)
3. `three.min.js` (3D 渲染)
4. `potree.js` (主库)
5. `main.ts` (Vue 应用)

**验证清单**:
```bash
# 确认所有依赖文件存在且非空
docker exec lanelet-frontend ls /usr/share/nginx/html/libs/jquery/jquery-3.1.1.min.js
docker exec lanelet-frontend ls /usr/share/nginx/html/libs/proj4/proj4.js
docker exec lanelet-frontend ls /usr/share/nginx/html/libs/three.js/three.min.js
```

---

## 五、后续优化方案

### 5.1 PCD 转换流程优化

#### 现状
- 三步手动: `pcd2las.py` → `convert_pointcloud.sh` → 前端刷新
- 不支持 `DATA ascii` 和 `DATA binary_compressed` 格式 PCD

#### 优化方案
1. **集成到后端 API**: 前端上传 PCD → 后端自动调用 `pcd2las.py` + PotreeConverter → 返回完成状态
   ```python
   @app.post("/api/pointclouds/upload")
   async def upload(file: UploadFile, name: str):
       save_pcd(file)
       run_pcd2las(pcd_path, las_path)
       run_potreeconverter(las_path, out_dir)
       return {"status": "ok"}
   ```

2. **扩展 PCD 格式支持**:
   - `DATA ascii`: 逐行 `split()` 解析
   - `DATA binary_compressed`: 实现 LZF 解压算法
   - 8 字节 double x/y/z: 支持 `('F', 8) → 'f8'`

3. **缓存机制**: 对同一 PCD 文件做 hash 校验,避免重复转换

### 5.2 性能优化

| 场景 | 当前 | 优化方案 |
|------|------|---------|
| 大点云加载 | PotreeConverter 默认参数 | `--level StepSize=0.5` 控制八叉树层级 |
| 渲染性能 | `setPointBudget(2_000_000)` | 根据服务器 GPU 动态调整 |
| Docker 镜像体积 | 前端 ~80MB | 用 nginx:alpine + gzip |
| 后端启动速度 | pip 装 lanelet2 ~10s | 构建基础镜像 `lanelet2-base:latest` 缓存 |
| **前端构建慢(400s)** | `rebuild` 用 `--no-cache` + `apk add unzip` + npm 慢 | 改为分层缓存: ① 删除 `apk add unzip`(busybox 自带) ② `rebuild` 走缓存 ③ npm 用 cache mount |

### 5.3 部署优化

1. **预构建镜像**: 把 lanelet2 + PotreeConverter 打到一个基础镜像,后续只 COPY 应用代码
2. **Nginx gzip**: 开启 `gzip_types application/json text/css application/javascript`
3. **健康检查**: docker-compose 加 `healthcheck` 字段
4. **日志卷**: 后端日志持久化到 `/data/logs/`

---

## 六、后续开发计划

> 需求扩展(2026-07-14): 在原画线功能基础上,增加 PCD 自动转换、文件管理、
> 红绿灯/马路沿/车道方向/点位交叉检测等 Vector Map Builder 全功能对标。
> 拆分为 6 轮渐进式开发,每轮独立可交付。

### 第 2 轮(进行中): 文件管理 + PCD 自动转换 + 转换进度

**目标**: 上传 PCD → 后端自动转 LAS + 转 Potree → 前端实时看进度 → 文件可管理

#### 后端
- [x] 集成 `pcd2las.py` 到 `app/converters/pcd2las.py`
- [x] `POST /api/pointclouds/upload` 改造: 上传后自动触发 PCD→LAS→Potree 两步转换
- [x] `GET /api/pointclouds/{name}/status` — 查询转换状态(pending/converting/done/error)
- [x] `GET /api/pointclouds/{name}/progress` — SSE 流式推送转换进度
- [x] `DELETE /api/pointclouds/{name}` — 删除点云(同时删 raw + pointcloud 目录)
- [x] `GET /api/pointclouds/{name}/download` — 下载原始 PCD/LAS 文件
- [x] `POST /api/pointclouds/{name}/rename` — 重命名
- [x] `GET /api/files` — 统一文件列表(含 raw / converted / size / status)
- [x] PotreeConverter 路径配置化(`config.py` 加 `potreeconverter_path`)
- [x] docker-compose.yml 挂载 `/opt/potreeconverter` 到后端容器

#### 前端
- [x] 新建 `FileManager.vue` 组件(上传/进度/列表/删除/下载/重命名)
- [x] API 封装 `api/index.ts` 新增: listFiles / uploadPointcloud / getConvertStatus / subscribeProgress / deletePointcloud / downloadUrl / renamePointcloud
- [x] MapView.vue 集成 FileManager 到"文件"标签页
- [x] 上传时显示转换进度条(SSE 订阅,EventSource)
- [x] 上传完成后自动刷新列表 + 可点击加载
- [x] 点云拾取基础能力(第 3 轮深化)

#### 交付物
- 上传 PCD 后无需手动跑脚本,后端自动完成两步转换
- 前端实时显示"上传中 → 转换 LAS 中 → 转换 Potree 中 → 完成"
- 可删除/下载/重命名任意点云文件

---

### 第 3 轮: 点云拾取 + LineString 画线 + 车道线/马路沿

**目标**: 在点云上画各类线元素(车道线、马路沿、虚拟线等)

#### 前端
- [ ] Potree 点云拾取(射线检测 + 点命中)
- [ ] LineString 绘制管理器(Three.js Line + BufferGeometry)
  - 点击添加锚点
  - 实时预览折线
  - 撤销/重做
  - 完成/取消
- [ ] LineString 类型选择面板:
  - `line_thin` / `line_thick` (细/粗车道线)
  - `dashed` / `solid` (虚线/实线)
  - `curbstone` (马路沿)
  - `virtual` (虚拟线)
  - `road_border` (路缘)
- [ ] LineString 列表面板(显示已绘制线条,可编辑/删除)
- [ ] 鼠标坐标实时显示(右下角状态栏)

#### 后端
- [ ] `POST /api/linestrings` — 创建 LineString(传 coords + type/subtype,返回 id)
- [ ] `GET /api/linestrings` — 列出所有 LineString(含 type/subtype/coords)
- [ ] `PUT /api/linestrings/{id}` — 更新坐标或属性
- [ ] `DELETE /api/linestrings/{id}` — 删除
- [ ] lanelet2 `LineString3d` 持久化到内存 + JSON 文件

#### 交付物
- 前端能拾取点云坐标
- 能画多种类型 LineString 并提交到后端
- 支持车道线、马路沿等不同线型

---

### 第 4 轮: Lanelet 组装 + 车道方向 + 拓扑关系

**目标**: 把 LineString 组装成 Lanelet,建立车道方向和拓扑连接

#### 前端
- [ ] Lanelet 组装交互(选两条 LineString 作为左右边界 → 创建 Lanelet)
- [ ] Lanelet 可视化(半透明面片填充 + 方向箭头)
- [ ] 车道方向编辑(正向/反向)
- [ ] 拓扑编辑(连接 Lanelet 的前驱/后继/汇入/汇出)
- [ ] 属性面板(type/subtype/speed_limit/width 等)

#### 后端
- [ ] `POST /api/lanelets` — 创建 Lanelet(left_id, right_id, attrs)
- [ ] `GET /api/lanelets` — 列出所有 Lanelet
- [ ] `PUT /api/lanelets/{id}` — 更新属性或左右边界
- [ ] `PUT /api/lanelets/{id}/relations` — 更新拓扑关系(predecessor/successor/left/right)
- [ ] `DELETE /api/lanelets/{id}` — 删除
- [ ] lanelet2 `Lanelet` 对象管理 + 持久化

#### 交付物
- 能把车道线组装成车道(Lanelet)
- 能编辑车道方向和拓扑关系
- 拓扑关系可视化(箭头/连接线)

---

### 第 5 轮: 红绿灯 + 停止线 + RegulatoryElement

**目标**: 添加交通信号元素,关联到 Lanelet

#### 前端
- [ ] 红绿灯元素创建(点位 + 朝向 + 灯组)
- [ ] 停止线绘制(特殊 LineString)
- [ ] 斑马线 / 人行横道
- [ ] RegulatoryElement 关联面板(把红绿灯/停止线关联到 Lanelet)
- [ ] 交通标志元素(限速/禁停/让行等)

#### 后端
- [ ] `POST /api/regulatory_elements` — 创建 RegulatoryElement
- [ ] `GET /api/regulatory_elements` — 列表
- [ ] `PUT /api/lanelets/{id}/regulatory` — 关联 RegulatoryElement 到 Lanelet
- [ ] lanelet2 `RegulatoryElement` 管理

#### 交付物
- 能添加红绿灯、停止线、交通标志
- 能关联到对应车道
- 与 Autoware 交通信号感知对接

---

### 第 6 轮: OSM 导入导出 + 坐标系对齐 + 点位交叉检测

**目标**: 与 Autoware 完整对接,支持导入现有地图 + 拓扑校验

#### 关键工作
- [ ] 坐标系对齐: PCD 局部坐标 → WGS84 经纬度(通过原点 UTM 投影)
- [ ] 原点配置界面(让用户输入采集地经纬度,或从 PCD VIEWPOINT 自动提取)
- [ ] `POST /api/export` — 导出 Lanelet2 .osm 文件(含所有元素)
- [ ] `POST /api/import` — 导入已有 .osm 文件并可视化
- [ ] **点位交叉检测**: 自动检测 LineString 交叉点,提示可能需要加 TrafficLight/StopLine
- [ ] **拓扑校验**: 检查 Lanelet 拓扑完整性(孤立车道、断头路、方向冲突)
- [ ] **几何校验**: 检查 LineString 重叠、自相交
- [ ] 在 Autoware 中验证导出的 .osm 可加载

#### 交付物
- 能导出 Autoware 可识别的完整 Lanelet2 地图
- 能导入现有 .osm 并编辑
- 自动检测拓扑/几何问题并提示

---

### 第 7 轮(可选): 高级功能

- [ ] 多用户 / 项目隔离(每个项目独立地图)
- [ ] 版本管理(Git LFS 或自实现历史)
- [ ] 车道线自动吸附算法(基于点云法向量估计)
- [ ] Lanelet 拓扑可视化(D3 力导向图)
- [ ] 批量操作(多选 LineString 批量改类型)
- [ ] 撤销/重做全局栈
- [ ] 导出格式扩展(OpenDRIVE)

---

## 七、技术债务

### 7.1 当前已知
1. **PCD 转换未集成到后端**: 用户需手动跑两个脚本
2. **PCD 格式覆盖不全**: 不支持 ascii / binary_compressed
3. **前端依赖硬编码**: index.html 中 JS 路径写死,升级 Potree 版本需手动改
4. **无数据持久化**: 后端重启后 LineString/Lanelet 丢失(第 2 轮实现)
5. **无坐标系配置**: 原点经纬度写死在上海(第 4 轮实现)

### 7.2 建议清理
- 把 `pcd2las.py` 集成到后端 `app/converters/pcd2las.py`
- 把 PotreeConverter 路径配置化(`config.py`)
- 添加 `.env` 文件管理环境变量

---

## 八、快速启动指南

### 8.1 首次部署

```bash
# 1. 编译 PotreeConverter(一次性,约 5 分钟)
./build_potreeconverter.sh

# 2. 启动前后端
./start.sh

# 3. 转换点云
python3 pcd2las.py data/raw/xxx.pcd data/raw/xxx.las
./convert_pointcloud.sh data/raw/xxx.las my_map

# 4. 浏览器访问
# http://<server-ip>:8080
```

### 8.2 日常使用

```bash
# 启动
./start.sh

# 停止
./start.sh stop

# 查看日志
./start.sh logs

# 重新构建(代码更新后)
./start.sh rebuild
```

### 8.3 健康检查

```bash
curl http://localhost:8000/api/health
# 期望: {"status":"ok","lanelet2_available":true,...}
```

---

## 九、参考资源

- [Potree 官网](https://potree.org/)
- [PotreeConverter GitHub](https://github.com/potree/PotreeConverter)
- [lanelet2 Python 库](https://github.com/fzi-forschungszentrum-informatik/Lanelet2)
- [Tier IV Vector Map Builder](https://tools.tier4.jp/feature/vector_map_builder_ll2/)
- [Autocore MapToolbox](https://github.com/autocore-ai/MapToolbox)
