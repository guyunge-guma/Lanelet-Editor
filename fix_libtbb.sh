#!/bin/bash
# ============================================================
# 修复 libtbb.so.12 缺失/版本不匹配问题
#
# 问题: PotreeConverter 在宿主机(RHEL 10)编译,链接宿主机的 libtbb.so.12。
#       容器(Debian)内没有匹配版本,手动复制的版本可能 ABI 不兼容,
#       导致并行处理静默失败,点位大幅丢失。
#
# 本脚本: 从宿主机查找编译时链接的 libtbb.so.12,复制到 /opt/potreeconverter/lib/
#         通过 docker-compose 挂载到容器内,确保 ABI 完全匹配。
#
# 用法: sudo ./fix_libtbb.sh
# ============================================================
set -e

INSTALL_DIR=/opt/potreeconverter
CONVERTER="$INSTALL_DIR/PotreeConverter"

if [ ! -f "$CONVERTER" ]; then
    echo "❌ PotreeConverter 未找到: $CONVERTER"
    echo "   请先运行: ./build_potreeconverter.sh"
    exit 1
fi

echo "=== 1. 检查 PotreeConverter 当前依赖 ==="
ldd "$CONVERTER" | grep -E "libtbb|liblaszip" || true

echo ""
echo "=== 2. 查找宿主机上的 libtbb.so.12 ==="

# 方法 1: 从 ldd 输出中提取
TBB_LIB=$(ldd "$CONVERTER" 2>/dev/null | grep libtbb | awk '{print $3}')

# 方法 2: 如果 ldd 找不到(因为库不在搜索路径中),全局搜索
if [ -z "$TBB_LIB" ] || [ ! -f "$TBB_LIB" ]; then
    echo "ldd 未找到,尝试全局搜索..."
    TBB_LIB=$(find /usr/lib /usr/lib64 /lib /lib64 -name "libtbb.so.12*" 2>/dev/null | head -1)
fi

# 方法 3: 从 tbb-devel 包安装位置查找
if [ -z "$TBB_LIB" ] || [ ! -f "$TBB_LIB" ]; then
    echo "全局搜索未找到,尝试 rpm 查询..."
    TBB_LIB=$(rpm -ql tbb 2>/dev/null | grep "libtbb.so.12" | head -1)
fi

if [ -z "$TBB_LIB" ] || [ ! -f "$TBB_LIB" ]; then
    echo "❌ 未找到 libtbb.so.12"
    echo "   请安装: dnf install -y tbb"
    exit 1
fi

# 跟随符号链接获取真实文件
TBB_REAL=$(readlink -f "$TBB_LIB")
echo "找到: $TBB_LIB (实际文件: $TBB_REAL)"

echo ""
echo "=== 3. 复制到 $INSTALL_DIR/lib/ ==="
mkdir -p "$INSTALL_DIR/lib"

# 关键: 先复制真实文件(跟随符号链接),用 SONAME 命名
# 不能先 cp 再 ln -sf,否则 ln 会把刚复制的真实文件替换成指向不存在文件的坏链接
TBB_SONAME=$(basename "$TBB_LIB")      # 如: libtbb.so.12
TBB_REALNAME=$(basename "$TBB_REAL")    # 如: libtbb.so.12.11

# 删除可能存在的旧文件/坏链接
rm -f "$INSTALL_DIR/lib/$TBB_SONAME" "$INSTALL_DIR/lib/$TBB_REALNAME"

# 复制真实文件内容(用 -L 跟随符号链接),保存为 SONAME
cp -L "$TBB_LIB" "$INSTALL_DIR/lib/$TBB_SONAME"

# 验证是真实文件而非符号链接
if [ -L "$INSTALL_DIR/lib/$TBB_SONAME" ]; then
    echo "❌ 错误: 复制后仍为符号链接,手动修复:"
    echo "   cp -L $TBB_REAL $INSTALL_DIR/lib/$TBB_SONAME"
    exit 1
fi

echo "已复制: $TBB_REAL -> $INSTALL_DIR/lib/$TBB_SONAME (真实文件, $(stat -c%s "$INSTALL_DIR/lib/$TBB_SONAME") 字节)"

echo ""
echo "=== 4. 验证依赖(使用安装目录的库) ==="
LD_LIBRARY_PATH="$INSTALL_DIR/lib" ldd "$CONVERTER" | grep -E "libtbb|liblaszip"

echo ""
echo "=== 5. 容器内验证 ==="
docker exec lanelet-backend ldd /opt/potreeconverter/PotreeConverter 2>/dev/null | grep -E "libtbb|liblaszip" || \
    echo "⚠️  容器未运行或未挂载,重启后验证"

echo ""
echo "✅ 修复完成!"
echo ""
echo "下一步操作:"
echo "  1. 重启后端容器: docker compose restart backend"
echo "  2. 删除旧的转换结果: docker exec lanelet-backend rm -rf /app/data/pointclouds/industrial_area"
echo "  3. 重新转换: 通过前端重新上传,或手动执行:"
echo "     docker exec lanelet-backend /opt/potreeconverter/PotreeConverter \\"
echo "       /app/data/raw/industrial_area.las \\"
echo "       -o /app/data/pointclouds/industrial_area \\"
echo "       --output-format LAZ --attributes POSITION RGB"
