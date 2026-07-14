#!/bin/bash
# 在服务器上编译安装 PotreeConverter
# 用法: ./build_potreeconverter.sh
set -e

INSTALL_DIR=/opt/potreeconverter
SRC_DIR=/tmp/PotreeConverter-src

echo "[1/4] 安装编译依赖..."
# 判断用 dnf 还是 yum
PKG_MGR="yum"
if command -v dnf &>/dev/null; then
    PKG_MGR="dnf"
fi

# 启用 PowerTools/CRB 仓库(boost/las 等开发包需要)
if [ "$PKG_MGR" = "dnf" ]; then
    # RHEL 9 / CentOS Stream 9 / Rocky 9 / Alma 9
    dnf install -y -q 'dnf-command(config-manager)' || true
    dnf config-manager --set-enabled crb 2>/dev/null || true
    dnf install -y -q epel-release || true
else
    # RHEL 8 / CentOS 8
    dnf install -y -q 'dnf-command(config-manager)' || true
    dnf config-manager --set-enabled powertools 2>/dev/null || true
    dnf install -y -q epel-release || true
fi

$PKG_MGR install -y -q \
    gcc gcc-c++ cmake git make \
    tbb-devel boost-devel boost-system boost-thread \
    LASlib-devel libgeotiff-devel \
    zlib-devel xz-devel

echo "[2/4] 克隆 PotreeConverter 源码..."
rm -rf "$SRC_DIR"
git clone --depth 1 --branch 2.1.3 \
    https://gh-proxy.org/https://github.com/potree/PotreeConverter.git \
    "$SRC_DIR"

echo "[3/4] 编译..."
mkdir -p "$SRC_DIR/build"
cd "$SRC_DIR/build"
cmake -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" \
      ..
make -j"$(nproc)"

echo "[4/4] 安装到 $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp PotreeConverter "$INSTALL_DIR/"

# 验证
echo ""
echo "✅ PotreeConverter 安装成功"
"$INSTALL_DIR/PotreeConverter" --help 2>&1 | head -5 || true
echo ""
echo "可执行文件位置: $INSTALL_DIR/PotreeConverter"
echo ""
echo "下一步: 用 convert_pointcloud.sh 转换 PCD 文件"
