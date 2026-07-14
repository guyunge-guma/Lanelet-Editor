#!/bin/bash
# 在服务器上编译安装 PotreeConverter 2.1.3
# 用法: ./build_potreeconverter.sh
set -e

INSTALL_DIR=/opt/potreeconverter
SRC_DIR=/tmp/PotreeConverter-src

echo "[1/4] 安装编译依赖..."
# RHEL 10 用 dnf
PKG_MGR="yum"
if command -v dnf &>/dev/null; then
    PKG_MGR="dnf"
fi

# 启用 CRB/EPEL 仓库(tbb-devel 在这里)
$PKG_MGR install -y -q epel-release 2>/dev/null || true
$PKG_MGR install -y -q 'dnf-command(config-manager)' 2>/dev/null || true
$PKG_MGR config-manager --set-enabled crb 2>/dev/null || true

# PotreeConverter 2.1.3 自带 laszip 和 brotli 源码
# 只需要编译工具和 TBB
$PKG_MGR install -y -q \
    gcc gcc-c++ cmake git make \
    tbb-devel \
    zlib-devel

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
# 复制 page_template(PotreeConverter 需要这个目录)
cp -r "$SRC_DIR/resources" "$INSTALL_DIR/" 2>/dev/null || true

# 验证
echo ""
echo "✅ PotreeConverter 安装成功"
"$INSTALL_DIR/PotreeConverter" --help 2>&1 | head -10 || true
echo ""
echo "可执行文件位置: $INSTALL_DIR/PotreeConverter"
echo ""
echo "下一步: ./convert_pointcloud.sh data/raw/industrial_area.pcd industrial_area"
