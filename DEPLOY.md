# Lanelet Editor 部署指南

> 本文档面向运维/部署人员,介绍在 CentOS / RHEL 10 服务器上私有化部署 Lanelet Editor 的完整流程。
>
> 推荐使用 **一键部署脚本** `deploy.sh`;如需理解每一步,可参考下文「手动部署」章节。

---

## 一、项目简介

**Lanelet Editor** 是一个基于 **Potree + lanelet2** 的私有化部署 Web 端 **Lanelet2 矢量地图编辑器**,对标 Tier IV 的 Vector Map Builder(其仅 SaaS、非开源)。

核心能力:

- 点云可视化:基于 Potree 1.8.2(WebGL,亿级点流畅渲染)
- 点云转换:PCD/LAS → Potree 八叉树(调用宿主机编译的 PotreeConverter 2.1.3)
- Lanelet2 矢量地图编辑:LineString / Lanelet / RegulatoryElement / TrafficLight / StopLine 增删改查
- 拓扑与几何校验、Lanelet2 `.osm` 导入/导出
- 前后端分离,REST API + SSE 进度推送

### 架构

```
浏览器 (Vue3 + Potree)
   │  REST + 静态文件
   ▼
nginx (前端, 反向代理) ── /pointclouds/* ── 静态文件
   │  /api/*
   ▼
FastAPI (uvicorn, 后端)
   ├── lanelet2 Python 绑定
   └── subprocess 调用 PotreeConverter(宿主机 /opt/potreeconverter,只读挂载)
```

### 技术栈

| 层 | 选型 |
|----|------|
| 点云渲染 | Potree 1.8.2 |
| 前端 | Vue3 + Vite + TypeScript + Element Plus |
| 后端 | FastAPI (Python 3.11) + uvicorn |
| 矢量地图 | lanelet2 Python 绑定 |
| 点云转换 | PotreeConverter 2.1.3(宿主机编译) |
| 部署 | Docker Compose(前端 nginx + 后端 uvicorn) |

---

## 二、系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | CentOS Stream 10 / RHEL 10(推荐),亦支持 Ubuntu 22.04+ / Debian 12+ |
| CPU | 8 核 |
| 内存 | 16 GB |
| 磁盘 | 300 GB HDD(点云原始文件与转换结果占用较大) |
| 权限 | root(脚本需安装 Docker、编译 PotreeConverter) |
| 网络 | 需访问外网拉取镜像与源码(已全部走国内源/代理) |
| 端口 | 80(前端)、8000(后端),需对外可访问且未被占用 |

> 首次构建需从 GitHub 下载 Potree 源码、从 PyPI 下载 lanelet2,请确保服务器能访问 `gh-proxy.org` 与 `pypi.tuna.tsinghua.edu.cn`。

---

## 三、端口说明

| 服务 | 容器端口 | 宿主机端口 | 说明 |
|------|----------|------------|------|
| 前端 (nginx) | 80 | **80** | 浏览器访问入口;反向代理 `/api/*`、`/pointclouds/*` 到后端 |
| 后端 (FastAPI) | 8000 | **8000** | REST API;健康检查 `/api/health`,Swagger 文档 `/docs` |

- 前端 nginx 已配置反向代理,日常只需暴露 **80** 端口即可同时使用前端页面与 API。
- 后端 8000 端口单独暴露,便于直连调试与调用 `/api/health`、`/docs`。
- 若 80 端口被占用,可修改 `docker-compose.yml` 中 `ports: - "80:80"` 为 `"8080:80"`,并同步更新防火墙放行规则。

### 防火墙放行(CentOS/RHEL)

```bash
firewall-cmd --permanent --add-port=80/tcp
firewall-cmd --permanent --add-port=8000/tcp
firewall-cmd --reload
```

---

## 四、环境准备:安装 Docker + Docker Compose(国内源)

> 一键脚本 `deploy.sh` 会自动完成本节所有步骤。以下为手动操作说明。

### 4.1 CentOS / RHEL 10

```bash
# 清理旧版本
yum remove -y docker docker-client docker-client-latest docker-common \
    docker-latest docker-latest-logrotate docker-logrotate docker-engine

# 安装 yum-utils 并添加阿里云 docker-ce 仓库
yum install -y yum-utils
yum-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
sed -i 's|download.docker.com|mirrors.aliyun.com|g' /etc/yum.repos.d/docker-ce.repo

# 安装 Docker 与 Compose 插件
yum install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

systemctl start docker
systemctl enable docker
```

### 4.2 Ubuntu / Debian

```bash
apt-get update
apt-get install -y ca-certificates curl gnupg apt-transport-https
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
    > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

systemctl start docker
systemctl enable docker
```

### 4.3 配置 Docker 镜像加速

写入 `/etc/docker/daemon.json`(脚本会自动生成):

```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1panel.live",
    "https://dockerproxy.com"
  ],
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "3" },
  "live-restore": true
}
```

> 公共镜像加速器时常变动。如拉取 Docker Hub 镜像仍很慢,请到
> [阿里云容器镜像服务](https://cr.console.aliyun.com) 申请**个人加速器地址**
> (形如 `https://xxxx.mirror.aliyuncs.com`),加入 `registry-mirrors` 后执行:
>
> ```bash
> systemctl daemon-reload && systemctl restart docker
> ```

### 4.4 验证

```bash
docker --version
docker compose version
docker run --rm hello-world   # 走加速器拉取测试
```

---

## 五、一键部署(推荐)

### 5.1 上传项目

将整个项目目录上传到服务器,例如 `/opt/lanelet-editor`:

```bash
# 方式一: rsync
rsync -avz ./lanelet-editor/ root@<服务器IP>:/opt/lanelet-editor/

# 方式二: scp 压缩包后解压
```

### 5.2 执行部署脚本

```bash
cd /opt/lanelet-editor
chmod +x deploy.sh
sudo ./deploy.sh
```

脚本会依次完成:

1. 检查 / 安装 Docker + Docker Compose(国内源)
2. 配置 Docker 镜像加速(`/etc/docker/daemon.json`)
3. 配置 npm 淘宝镜像、pip 清华源、GitHub `gh-proxy.org` 代理
4. 检查并编译宿主机 PotreeConverter(若 `/opt/potreeconverter` 不存在)
5. 创建数据目录 `data/raw`、`data/pointclouds`、`data/exports`
6. `docker compose build` + `docker compose up -d`
7. 轮询健康检查(`/api/health` 与前端首页)
8. 输出访问地址

### 5.3 脚本参数

| 命令 | 作用 |
|------|------|
| `sudo ./deploy.sh` | 标准部署(增量构建) |
| `sudo ./deploy.sh --rebuild` | 无缓存全量重新构建(改 Dockerfile / 依赖时用) |
| `sudo ./deploy.sh --down` | 停止并清理容器(数据目录保留) |

### 5.4 访问

部署完成后,脚本会输出服务器 IP。浏览器打开:

```
http://<服务器IP>
```

---

## 六、手动部署

如不使用一键脚本,按以下步骤操作。

### 6.1 完成环境准备

按「第四节」安装 Docker、Docker Compose 并配置镜像加速。

### 6.2 配置国内源(宿主机,可选但推荐)

```bash
# npm 淘宝镜像(宿主机若装了 node)
npm config set registry https://registry.npmmirror.com

# pip 清华源(宿主机若装了 pip)
pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
pip config set global.trusted-host pypi.tuna.tsinghua.edu.cn

# GitHub 代理:所有 github.com 克隆走 gh-proxy.org
git config --global url."https://gh-proxy.org/https://github.com/".insteadOf "https://github.com/"
```

> 容器内的源已在 `backend/Dockerfile`、`frontend/Dockerfile` 中硬编码配置(Debian apt 阿里云、pip 清华、npm 淘宝、GitHub gh-proxy),无需额外干预。

### 6.3 编译 PotreeConverter(关键宿主机依赖)

PotreeConverter 必须在**宿主机**编译(保证 libtbb ABI 与宿主机一致),再以只读方式挂载进后端容器。

```bash
cd /opt/lanelet-editor
chmod +x build_potreeconverter.sh
sudo ./build_potreeconverter.sh
```

脚本会:启用 EPEL/CRB 仓库 → 安装 `gcc cmake tbb-devel` → 克隆 PotreeConverter 2.1.3(走 gh-proxy)→ 编译安装到 `/opt/potreeconverter` → 复制 `libtbb.so.12` 到 `/opt/potreeconverter/lib/`。

验证:

```bash
ls -l /opt/potreeconverter/PotreeConverter
ls -l /opt/potreeconverter/lib/   # 应有 libtbb.so.12
```

### 6.4 创建数据目录

```bash
mkdir -p data/raw data/pointclouds data/exports
```

### 6.5 构建并启动

```bash
docker compose build          # 首次较慢(需构建 Potree 源码 + 前端)
docker compose up -d
```

### 6.6 健康检查

```bash
# 后端
curl http://localhost:8000/api/health
# 期望返回: {"status":"ok","lanelet2_available":true,...}

# 前端首页
curl -I http://localhost/
# 期望返回: HTTP/1.1 200 OK
```

### 6.7 修改投影原点(生产环境必做)

编辑 `docker-compose.yml` 中后端的 `ORIGIN_LAT` / `ORIGIN_LON`(默认上海),改为实际采集点经纬度,然后:

```bash
docker compose up -d   # 重新创建后端容器使环境变量生效
```

---

## 七、网络配置说明(国内源 / GitHub 代理)

为保证国内服务器构建顺畅,所有依赖均已配置国内可达地址:

| 依赖来源 | 国内地址 | 配置位置 |
|----------|----------|----------|
| Docker Hub 镜像 | 阿里云/DaoCloud 加速器 | `/etc/docker/daemon.json` `registry-mirrors` |
| Debian apt | `mirrors.aliyun.com` | `backend/Dockerfile` `sed` |
| Alpine apk | `mirrors.aliyun.com` | `frontend/Dockerfile` `sed` |
| pip / PyPI | `pypi.tuna.tsinghua.edu.cn` | `backend/Dockerfile` `pip config` |
| npm | `registry.npmmirror.com` | `frontend/Dockerfile` `npm config` |
| GitHub 源码 | `https://gh-proxy.org/https://github.com/...` | 两个 Dockerfile + `build_potreeconverter.sh` |
| lanelet2 wheel | PyPI,失败回退 gh-proxy GitHub Release | `backend/Dockerfile` |

GitHub 加速前缀统一为 `https://gh-proxy.org/https://github.com/`,例如:

```
原:  https://github.com/potree/potree.git
加速: https://gh-proxy.org/https://github.com/potree/potree.git
```

> 若 `gh-proxy.org` 不可用,可替换为其他公共 GitHub 代理,如 `https://ghproxy.net/https://github.com/` 或 `https://mirror.ghproxy.com/https://github.com/`,需同步修改 Dockerfile 与脚本中的前缀。

---

## 八、数据目录说明

所有持久化数据位于项目根目录的 `./data`,通过卷映射挂载到后端容器 `/app/data`,容器重启/重建不丢失:

| 路径 | 容器内路径 | 说明 |
|------|-----------|------|
| `data/raw/` | `/app/data/raw/` | 上传的原始 PCD/LAS/PLY 文件,及 PCD→LAS 中间产物 |
| `data/pointclouds/` | `/app/data/pointclouds/` | PotreeConverter 转换后的点云(供前端 Potree 加载) |
| `data/exports/` | `/app/data/exports/` | 导出的 Lanelet2 `.osm` 地图文件 |
| `data/map.json` | `/app/data/map.json` | Lanelet2 地图 JSON 持久化文件(自动保存/加载) |

宿主机 `/opt/potreeconverter` 以只读方式挂载到后端容器同路径,后端通过 `subprocess` 调用其中的 `PotreeConverter` 可执行文件。

### 日志

容器日志使用 Docker `json-file` 驱动,单文件上限 50MB、保留 5 个(在 `docker-compose.yml` 的 `logging` 段配置),查看:

```bash
docker compose logs -f            # 全部
docker compose logs -f backend    # 仅后端
docker compose logs -f frontend   # 仅前端
```

---

## 九、常见问题排查

### 9.1 端口被占用

```
Error starting userland proxy: listen tcp4 0.0.0.0:80: bind: address already in use
```

- 查占用:`ss -lntp | grep ':80 '` 或 `lsof -i:80`
- 停掉占用进程,或修改 `docker-compose.yml` 中 `"80:80"` 为其他宿主机端口(如 `"8080:80"`)。

### 9.2 拉取 Docker 镜像超时

- 确认 `/etc/docker/daemon.json` 已配置 `registry-mirrors`,并 `systemctl restart docker`。
- 申请阿里云个人加速器地址加入列表(详见 4.3)。
- 手动预拉基础镜像:`docker pull python:3.11-slim`、`docker pull node:20-alpine`、`docker pull nginx:1.27-alpine`。

### 9.3 前端构建时 `git clone potree` 失败

- 多为 `gh-proxy.org` 临时不可用。更换代理前缀(见第七节)后重试。
- 或在能访问 GitHub 的机器上克隆后放入 `frontend/` 调整 Dockerfile。
- 重试:`sudo ./deploy.sh --rebuild`。

### 9.4 后端 `lanelet2_available: false`

- 容器内 lanelet2 安装失败。进入容器查看:
  ```bash
  docker exec -it lanelet-backend pip show lanelet2
  ```
- 手动安装(走 gh-proxy 回退地址):
  ```bash
  docker exec -it lanelet-backend pip install --no-cache-dir \
    "https://gh-proxy.org/https://github.com/fzi-forschungszentrum-informatik/Lanelet2/releases/download/1.2.2/lanelet2-1.2.2-cp311-cp311-manylinux_2_31_x86_64.whl"
  docker compose restart backend
  ```

### 9.5 点云转换后点位大量丢失(几乎为空)

**根因**:容器内 `libtbb` 版本与宿主机编译的 PotreeConverter ABI 不匹配,导致 TBB 并行处理静默失败。

**解决**:在宿主机重新执行修复脚本,确保 `libtbb.so.12` 来自宿主机编译时链接的同一文件:

```bash
sudo ./fix_libtbb.sh
docker compose restart backend
# 删除旧转换结果后重新转换(前端重新上传,或手动调用 /convert 接口)
```

### 9.6 PotreeConverter 未找到(`potreeconverter: false`)

- 后端挂载的 `/opt/potreeconverter/PotreeConverter` 不存在。
- 执行:`sudo ./build_potreeconverter.sh`,完成后 `docker compose restart backend`。

### 9.7 `deploy.sh` 在 Linux 报 `$'\r': command not found`

脚本在 Windows 编辑后带了 CRLF 行尾。转换:

```bash
sed -i 's/\r$//' deploy.sh
# 或
dnf install -y dos2unix && dos2unix deploy.sh
chmod +x deploy.sh
```

> 本仓库提供的 `deploy.sh` 已是 LF 行尾,通常无需此操作。

### 9.8 健康检查一直不通过

```bash
docker compose ps                  # 查看状态与 health
docker compose logs backend        # 看后端启动报错
docker compose logs frontend       # 看前端 nginx 报错
```

常见:后端启动慢(start_period 内未就绪)、端口/挂载配置错误、内存不足导致 OOM。

### 9.9 上传大点云 413 / 超时

前端 nginx 已设置 `client_max_body_size 1024m` 与 300s 超时。如仍失败,可在 `frontend/nginx.conf` 调大后重建前端。

---

## 十、运维命令速查

```bash
# 启动(已构建)
docker compose up -d

# 停止
docker compose down

# 重启
docker compose restart

# 查看实时日志
docker compose logs -f

# 查看容器健康状态
docker compose ps

# 增量重新构建(改了代码)
docker compose build && docker compose up -d

# 全量无缓存重建(改了 Dockerfile / 依赖)
sudo ./deploy.sh --rebuild

# 进入后端容器调试
docker exec -it lanelet-backend bash

# 备份数据
tar -czf lanelet-data-$(date +%F).tar.gz data/
```

### 更新版本

```bash
cd /opt/lanelet-editor
git pull                    # 或重新上传项目文件
sudo ./deploy.sh --rebuild  # 全量重建并启动
```
