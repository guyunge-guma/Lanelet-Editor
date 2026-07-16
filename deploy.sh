#!/bin/bash
# ============================================================
# Lanelet Editor 一键部署脚本
# 支持 CentOS / RHEL 10, Ubuntu, Debian
#
# 功能:
#   1. 检查 / 安装 Docker + Docker Compose(国内源)
#   2. 配置 Docker 镜像加速(阿里云 / DaoCloud)
#   3. 配置 npm 淘宝镜像、pip 清华源、GitHub gh-proxy.org 代理
#   4. 编译宿主机 PotreeConverter(若未安装)
#   5. docker compose build + up -d
#   6. 健康检查 + 输出访问地址
#
# 用法:
#   sudo ./deploy.sh            # 部署
#   sudo ./deploy.sh --rebuild  # 强制无缓存重新构建
#   sudo ./deploy.sh --down     # 停止并清理
# ============================================================
set -euo pipefail

# ---------- 颜色输出 ----------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; }
step() { echo -e "\n${BLUE}========== $* ==========${NC}"; }

# ---------- 必须以 root 运行 ----------
if [ "$(id -u)" -ne 0 ]; then
    err "本脚本需要 root 权限(安装 Docker / 编译 PotreeConverter)"
    err "请使用: sudo $0 $*"
    exit 1
fi

# ---------- 定位项目根目录 ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 国内源地址
NPM_REGISTRY="https://registry.npmmirror.com"
PIP_INDEX="https://pypi.tuna.tsinghua.edu.cn/simple"
PIP_HOST="pypi.tuna.tsinghua.edu.cn"
GH_PROXY="https://gh-proxy.org/https://github.com/"

# 解析参数
ACTION="deploy"
BUILD_FLAGS=""
for arg in "$@"; do
    case "$arg" in
        --rebuild) BUILD_FLAGS="--no-cache" ;;
        --down)    ACTION="down" ;;
        *) err "未知参数: $arg"; exit 1 ;;
    esac
done

# ============================================================
# 步骤 1: 检测 / 安装 Docker 与 Docker Compose
# ============================================================
install_docker_centos() {
    step "安装 Docker(CentOS / RHEL)"
    local PKG_MGR="yum"
    command -v dnf >/dev/null 2>&1 && PKG_MGR="dnf"

    # 清理旧版本
    $PKG_MGR remove -y docker docker-client docker-client-latest \
        docker-common docker-latest docker-latest-logrotate \
        docker-logrotate docker-engine 2>/dev/null || true

    $PKG_MGR install -y -q yum-utils curl
    # 阿里云 docker-ce 仓库
    $PKG_MGR config-manager --add-repo \
        https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
    sed -i 's|download.docker.com|mirrors.aliyun.com|g' \
        /etc/yum.repos.d/docker-ce.repo 2>/dev/null || true

    $PKG_MGR install -y -q docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
}

install_docker_ubuntu() {
    step "安装 Docker(Ubuntu / Debian)"
    apt-get update -qq
    apt-get install -y -q ca-certificates curl gnupg apt-transport-https
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    local CODENAME; CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://mirrors.aliyun.com/docker-ce/linux/ubuntu ${CODENAME} stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -q docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
}

ensure_docker() {
    if command -v docker >/dev/null 2>&1; then
        log "Docker 已安装: $(docker --version)"
    else
        if [ -f /etc/redhat-release ]; then
            install_docker_centos
        elif [ -f /etc/debian_version ]; then
            install_docker_ubuntu
        else
            err "不支持的操作系统,请手动安装 Docker"
            exit 1
        fi
    fi

    # 启动并设置开机自启
    systemctl start docker 2>/dev/null || true
    systemctl enable docker 2>/dev/null || true
}

ensure_compose() {
    if docker compose version >/dev/null 2>&1; then
        return 0
    elif command -v docker-compose >/dev/null 2>&1; then
        warn "使用独立版 docker-compose,建议升级为 docker compose 插件"
        return 0
    else
        err "Docker Compose 未安装,请安装 docker-compose-plugin"
        exit 1
    fi
}

# ============================================================
# 步骤 2: 配置 Docker 镜像加速
# ============================================================
configure_docker_mirror() {
    step "配置 Docker 镜像加速(国内源)"
    mkdir -p /etc/docker
    # 如已存在先备份
    [ -f /etc/docker/daemon.json ] && cp /etc/docker/daemon.json /etc/docker/daemon.json.bak.$(date +%s)

    cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1panel.live",
    "https://dockerproxy.com"
  ],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  },
  "live-restore": true
}
EOF
    log "已写入 /etc/docker/daemon.json"
    warn "如拉取镜像仍很慢,请到 https://cr.console.aliyun.com 申请个人加速器地址,"
    warn "将其 https://xxxx.mirror.aliyuncs.com 加入 registry-mirrors 后重启 Docker。"

    systemctl daemon-reload
    systemctl restart docker
    log "Docker 已重启,镜像加速生效"
}

# ============================================================
# 步骤 3: 配置 npm / pip / GitHub 代理
# ============================================================
configure_mirrors() {
    step "配置 npm / pip / GitHub 国内代理"

    # npm 淘宝镜像(宿主机若装了 node 则生效;容器内由 Dockerfile 单独配置)
    if command -v npm >/dev/null 2>&1; then
        npm config set registry "$NPM_REGISTRY"
        log "npm registry -> $NPM_REGISTRY"
    else
        log "宿主机未安装 npm(容器内将自行配置,可忽略)"
    fi

    # pip 清华源(宿主机若装了 pip 则生效;容器内由 Dockerfile 单独配置)
    local PIP_BIN=""
    command -v pip3 >/dev/null 2>&1 && PIP_BIN="pip3"
    command -v pip  >/dev/null 2>&1 && PIP_BIN="pip"
    if [ -n "$PIP_BIN" ]; then
        $PIP_BIN config set global.index-url "$PIP_INDEX"
        $PIP_BIN config set global.trusted-host "$PIP_HOST"
        log "pip index -> $PIP_INDEX"
    else
        log "宿主机未安装 pip(容器内将自行配置,可忽略)"
    fi

    # GitHub 代理: 全局 url 重写,所有 github.com clone 走 gh-proxy.org
    git config --global url."${GH_PROXY}".insteadOf "https://github.com/"
    log "git clone github.com -> ${GH_PROXY}"
    warn "已为 root 设置 git 全局代理,若需推送私有仓库请用 ssh 地址或取消该规则"
}

# ============================================================
# 步骤 4: 编译宿主机 PotreeConverter
# ============================================================
ensure_potreeconverter() {
    step "检查 PotreeConverter"
    if [ -x /opt/potreeconverter/PotreeConverter ]; then
        log "PotreeConverter 已存在: /opt/potreeconverter/PotreeConverter,跳过编译"
        return 0
    fi

    if [ ! -f ./build_potreeconverter.sh ]; then
        err "未找到 build_potreeconverter.sh,无法编译 PotreeConverter"
        err "后端点云转换功能将不可用,请手动编译后再运行本脚本"
        exit 1
    fi

    warn "PotreeConverter 未安装,开始编译(需要联网安装 tbb-devel / cmake 等)..."
    bash ./build_potreeconverter.sh

    if [ ! -x /opt/potreeconverter/PotreeConverter ]; then
        err "PotreeConverter 编译失败,请检查上方输出"
        exit 1
    fi
    log "PotreeConverter 编译成功"
}

# ============================================================
# 步骤 5: 准备数据目录
# ============================================================
prepare_data() {
    step "准备数据目录"
    mkdir -p ./data/raw ./data/pointclouds ./data/exports
    log "数据目录: $(pwd)/data"
}

# ============================================================
# 步骤 6: 构建 + 启动
# ============================================================
build_and_up() {
    step "构建 Docker 镜像(首次较慢,需下载 Potree 源码)"
    docker compose build $BUILD_FLAGS

    step "启动服务"
    docker compose up -d
}

# ============================================================
# 步骤 7: 健康检查
# ============================================================
wait_healthy() {
    step "等待服务健康"

    local fe_ok=0 be_ok=0
    for i in $(seq 1 40); do
        # 后端健康(走前端 nginx 反代,也可直连 8000)
        if [ "$be_ok" -eq 0 ] && curl -sf http://localhost:8000/api/health >/dev/null 2>&1; then
            be_ok=1
            log "后端 /api/health 检查通过"
        fi
        # 前端首页
        if [ "$fe_ok" -eq 0 ] && curl -sf -o /dev/null http://localhost/ >/dev/null 2>&1; then
            fe_ok=1
            log "前端首页检查通过"
        fi
        [ "$fe_ok" -eq 1 ] && [ "$be_ok" -eq 1 ] && break
        printf "."
        sleep 5
    done
    echo

    if [ "$be_ok" -eq 0 ]; then
        warn "后端健康检查未通过,查看日志: docker compose logs backend"
    fi
    if [ "$fe_ok" -eq 0 ]; then
        warn "前端健康检查未通过,查看日志: docker compose logs frontend"
    fi
}

# ============================================================
# 步骤 8: 输出访问地址
# ============================================================
print_summary() {
    step "部署完成"
    local SERVER_IP
    SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    [ -z "$SERVER_IP" ] && SERVER_IP="<服务器IP>"

    echo ""
    echo "  前端(浏览器访问):  http://${SERVER_IP}"
    echo "  后端 API 健康检查:  http://${SERVER_IP}:8000/api/health"
    echo "  API 文档(Swagger): http://${SERVER_IP}:8000/docs"
    echo ""
    echo "  常用命令:"
    echo "    查看日志:   docker compose logs -f"
    echo "    停止服务:   docker compose down"
    echo "    重启服务:   docker compose restart"
    echo "    重新构建:   sudo ./deploy.sh --rebuild"
    echo ""
    echo "  数据目录: $(pwd)/data"
    echo "  修改原点经纬度: 编辑 docker-compose.yml 中的 ORIGIN_LAT / ORIGIN_LON 后 docker compose up -d"
}

# ============================================================
# 停止并清理
# ============================================================
do_down() {
    step "停止并清理服务"
    docker compose down
    log "已停止(数据目录 ./data 保留)"
}

# ============================================================
# 主流程
# ============================================================
main() {
    echo -e "${BLUE}##########################################################${NC}"
    echo -e "${BLUE}#  Lanelet Editor 一键部署脚本                            #${NC}"
    echo -e "${BLUE}##########################################################${NC}"

    if [ "$ACTION" = "down" ]; then
        do_down
        exit 0
    fi

    ensure_docker
    ensure_compose
    configure_docker_mirror
    configure_mirrors
    ensure_potreeconverter
    prepare_data
    build_and_up
    wait_healthy
    print_summary
}

main "$@"
