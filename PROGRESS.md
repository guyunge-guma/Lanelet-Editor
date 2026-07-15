# Lanelet Editor - 项目进度与开发计划

> 基于 Potree + lanelet2 的私有化部署 Web 端 Lanelet2 矢量地图编辑器
>
> 最后更新: 2026-07-15

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
| 19 | `PotreeConverter: libtbb.so.12: cannot open shared object file` | 宿主机(RHEL 10)编译 PotreeConverter 链接了系统的 `libtbb.so.12`,但容器(Debian)内无此库 | ① `build_potreeconverter.sh` 编译后自动复制 `libtbb.so.12` 到 `/opt/potreeconverter/lib/` ② 提供 `fix_libtbb.sh` 一键修复脚本 ③ Dockerfile 移除 `libtbb-dev`(避免 Debian 版干扰) |
| 20 | `fix_libtbb.sh` 复制后 libtbb.so.12 变成坏链接 | `cp -L` 正确复制了真实文件,但随后 `ln -sf libtbb.so.12.11 libtbb.so.12` 把真实文件替换成了指向不存在文件的符号链接 | 修复脚本:直接 `cp -L` 保存为 SONAME,不再创建符号链接;验证是否为真实文件 |
| 21 | PotreeConverter 运行成功但点位大幅丢失(259 万点降到几乎为空) | **最终确认:不是 libtbb 问题**。真正原因是后端 `pcd2las.py` 的 `_build_dtype` 跳过了 padding 字段(`_`),导致 dtype itemsize(80) < 实际点大小(120),`frombuffer` 读取错位,X/Y/Z 全部读到错误字段的值 | 修复 `pcd2las.py`:padding 字段用 `_pad{i}` 保留在 dtype 中,不再跳过;添加 dtype itemsize 与 PCD 头部点大小的一致性校验 |
| 22 | 多个点云叠加显示,加载新的不删除旧的 | `MapView.vue` 的 `loadPointcloud` 只做 `addPointCloud`,不清理旧点云 | 加载新点云前遍历 `viewer.scene.pointclouds`,用 `splice` 移除 + `dispose()` 释放资源(见 Issue #24) |
| 23 | 已上传文件无法手动重新转换,必须重新上传 | 后端无手动转换 API | 新增 `POST /api/pointclouds/{name}/convert` 接口;前端 FileManager 未转换文件显示「转换」按钮,下拉菜单加「重新转换」 |
| 24 | `c.scene.removePointCloud is not a function` | Potree 1.8.2 的 `scene` 对象不提供 `removePointCloud` 方法 | 改用 `scene.pointclouds.splice()` 手动从数组移除 + 延迟 500ms 后 `geometry.dispose()` / `material.dispose()` 释放 GPU 资源 |
| 25 | 后端 Docker 构建时 apt 下载慢(196 秒) | Dockerfile 未配置国内 apt 源,默认走 `deb.debian.org` | 添加 `sed` 替换为 `mirrors.aliyun.com`,兼容 Debian 12 deb822 和传统 sources.list 两种格式 |
| 26 | 切换点云多次后崩溃 `Cannot read properties of null (reading 'attributes')` | `splice` 后立即 `dispose()` 销毁了 geometry,但 Potree 渲染循环是异步的,仍在引用已销毁的对象 | 改为先 `visible=false` + `splice` 移除,延迟 500ms 后再 `dispose()`,让渲染循环自然跳过已移除的点云 |

---

## 四、当前阻塞点

### 4.1 pcd2las.py padding 字段导致坐标错位(已修复)
**状态**: 已修复,待服务器重新构建验证

**问题**: 后端 `backend/app/converters/pcd2las.py` 的 `_build_dtype` 函数跳过了 padding 字段(名为 `_`),导致 numpy dtype itemsize(80 字节) < PCD 实际点大小(120 字节)。`np.frombuffer` 按 80 字节步长读取 120 字节的数据,所有字段全部错位 — X/Y/Z 读到的是其他字段的值,三个轴的范围完全一样([-78, 5242])。

**诊断方法**: 用 `convert_debug.sh` 从 PCD 直接转换(使用独立的 `pcd2las.py` 正确保留 padding),对比 API 转换结果:
- API 转换(错误): X/Y/Z 范围都是 [-78, 5242], octree.bin 12M, 157 万重复点
- 脚本转换(正确): X[-97,113] Y[-86,114] Z[-2.7,27.6], octree.bin 30M, 无重复点

**修复**:
1. `pcd2las.py`: padding 字段用 `_pad{i}` 唯一名保留在 dtype 中,不再跳过
2. `pcd2las.py`: 添加 dtype itemsize 与 PCD 头部声明的点大小一致性校验
3. `MapView.vue`: 加载新点云前移除场景中已有的旧点云,避免叠加

**验证步骤**:
```bash
# 1. 拉取代码并重新构建
git pull
docker compose up -d --build backend frontend

# 2. 删除旧的(错误的)转换结果和 LAS 文件
docker exec lanelet-backend rm -rf /app/data/pointclouds/industrial_area
docker exec lanelet-backend rm -f /app/data/raw/industrial_area.las

# 3. 重新转换(前端点"转换"按钮,或手动触发)
curl -X POST http://localhost:8000/api/pointclouds/industrial_area/convert

# 4. 验证坐标范围正确
docker exec lanelet-backend cat /app/data/pointclouds/industrial_area/metadata.json
# 期望: boundingBox min/max 的 X/Y/Z 范围不同,不是全部一样
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
- [x] `POST /api/pointclouds/{name}/convert` — 手动触发转换(无需重新上传)(2026-07-15 新增)
- [x] PotreeConverter 命令补齐 `--output-format LAZ --attributes POSITION RGB` 参数
- [x] 转换后验证 `metadata.json` + `hierarchy.bin` 完整性
- [x] `pcd2las.py` 修复 padding 字段跳过 bug(Issue #21)

#### 前端
- [x] 新建 `FileManager.vue` 组件(上传/进度/列表/删除/下载/重命名)
- [x] API 封装 `api/index.ts` 新增: listFiles / uploadPointcloud / getConvertStatus / subscribeProgress / deletePointcloud / downloadUrl / renamePointcloud
- [x] API 封装新增: `convertPointcloud` — 手动触发转换(2026-07-15)
- [x] MapView.vue 集成 FileManager 到"文件"标签页
- [x] 上传时显示转换进度条(SSE 订阅,EventSource)
- [x] 上传完成后自动刷新列表 + 可点击加载
- [x] 点云拾取基础能力(第 3 轮深化)
- [x] FileManager 未转换文件显示「转换」按钮 + 下拉菜单「重新转换」(2026-07-15)
- [x] MapView 加载新点云时移除旧点云,避免叠加(2026-07-15)

#### 交付物
- 上传 PCD 后无需手动跑脚本,后端自动完成两步转换
- 前端实时显示"上传中 → 转换 LAS 中 → 转换 Potree 中 → 完成"
- 可删除/下载/重命名任意点云文件
- 可手动重新转换(无需重新上传)
- 新增 `convert_debug.sh` 诊断转换脚本(打印 PCD 头部、LAS 点数、坐标范围、metadata.json)

---

### 第 3 轮: 点云拾取 + LineString 画线 + 车道线/马路沿 ✅

**目标**: 在点云上画各类线元素(车道线、马路沿、虚拟线等)

#### 前端
- [x] Potree 点云拾取(射线检测 + 点命中) — `DrawingManager.ts` 的 `pickPoint` 方法
- [x] LineString 绘制管理器(Three.js Line + BufferGeometry) — `DrawingManager.ts`
  - 点击添加锚点(红色球体)
  - 实时预览折线(绿色虚线)
  - 撤销(右键/Ctrl+Z)/完成(双击/Enter)/取消(Esc)
- [x] LineString 类型选择面板 — `LineStringPanel.vue`
  - `line_thin` / `line_thick` (细/粗车道线)
  - `dashed` / `solid` / `dotted` (虚线/实线/点线)
  - `curbstone` (马路沿: low/high)
  - `virtual` (虚拟线)
  - `road_border` (路缘)
- [x] LineString 列表面板(显示已绘制线条,可删除/清空)
- [x] 鼠标坐标实时显示(右下角状态栏)

#### 后端
- [x] `POST /api/linestrings` — 创建 LineString(传 coords + type/subtype,返回 id)
- [x] `GET /api/linestrings` — 列出所有 LineString(含 type/subtype/coords)
- [x] `GET /api/linestrings/{id}` — 获取单条 LineString
- [x] `PUT /api/linestrings/{id}` — 更新坐标或属性(删除旧的+创建新的,返回新 id)
- [x] `DELETE /api/linestrings/{id}` — 删除(被 Lanelet 引用时拒绝)
- [x] `DELETE /api/linestrings` — 清空所有 LineString
- [x] `POST /api/linestrings/save` — 保存到 JSON 文件
- [x] `POST /api/linestrings/load` — 从 JSON 文件加载
- [x] `GET /api/map/health` — 检查 lanelet2 和当前 map 状态
- [x] lanelet2 `LineString3d` 持久化到内存 + JSON 文件

#### 新增文件
- `frontend/src/utils/DrawingManager.ts` — Potree 点云拾取 + Three.js 线段绘制管理器
- `frontend/src/components/LineStringPanel.vue` — LineString 绘制面板(类型选择/绘制控制/线段列表/颜色图例)

#### 交付物
- 前端能拾取点云坐标(射线检测,Potree `pc.pick()`)
- 能画多种类型 LineString 并提交到后端(前端内部 id ↔ 后端 id 映射)
- 支持车道线、马路沿等不同线型(5 种类型 + 各自子类型)
- 绘制模式禁用 Potree 相机交互,非绘制模式恢复
- 鼠标悬停实时显示点云坐标(节流 40ms)
- 颜色图例(蓝/橙/灰/红)
- 地图可保存/加载 JSON 文件

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
1. ~~PCD 转换未集成到后端~~ ✅ 已集成(第 2 轮)
2. **PCD 格式覆盖不全**: 不支持 ascii / binary_compressed
3. **前端依赖硬编码**: index.html 中 JS 路径写死,升级 Potree 版本需手动改
4. **无数据持久化**: 后端重启后 LineString/Lanelet 丢失(第 2 轮实现)
5. **无坐标系配置**: 原点经纬度写死在上海(第 4 轮实现)
6. **根目录 `pcd2las.py` 与 `backend/app/converters/pcd2las.py` 重复**: 根目录的独立脚本保留 padding 字段(正确),后端版本曾跳过 padding(已修复),但两份代码应合并
7. **转换任务状态仅存内存**: 后端重启后 `_tasks` 字典丢失,SSE 中断后无法恢复

### 7.2 已清理
- ~~把 `pcd2las.py` 集成到后端 `app/converters/pcd2las.py`~~ ✅
- ~~把 PotreeConverter 路径配置化(`config.py`)~~ ✅
- ~~添加 `.env` 文件管理环境变量~~ ✅

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
