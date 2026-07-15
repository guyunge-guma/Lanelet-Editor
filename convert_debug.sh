#!/bin/bash
# ============================================================
# 诊断版点云转换脚本 — 输出到不同目录,方便与 API 转换结果对比
#
# 用法:
#   ./convert_debug.sh <input.pcd 或 input.las> [output_name]
#
# 示例:
#   ./convert_debug.sh data/raw/industrial_area.pcd industrial_area_manual
#   ./convert_debug.sh data/raw/industrial_area.las industrial_area_manual
#
# 输出到 data/pointclouds/<output_name>/
# 前端可通过 /pointclouds/<output_name>/metadata.json 加载
# ============================================================
set -e

CONVERTER=/opt/potreeconverter/PotreeConverter
PCD2LAS="python3 pcd2las.py"

if [ ! -f "$CONVERTER" ]; then
    echo "❌ PotreeConverter 未安装: $CONVERTER"
    echo "   请先运行: ./build_potreeconverter.sh"
    exit 1
fi

if [ $# -lt 1 ]; then
    echo "用法: $0 <input.pcd 或 input.las> [output_name]"
    echo "示例: $0 data/raw/industrial_area.pcd industrial_area_manual"
    exit 1
fi

INPUT=$1
OUTPUT_NAME=${2:-$(basename "$INPUT" | sed 's/\.[^.]*$//')_manual}
OUTPUT_DIR="$(pwd)/data/pointclouds/$OUTPUT_NAME"

if [ ! -f "$INPUT" ]; then
    echo "❌ 输入文件不存在: $INPUT"
    exit 1
fi

echo "============================================"
echo "  诊断版点云转换"
echo "============================================"
echo "输入文件:   $INPUT"
echo "文件大小:   $(du -h "$INPUT" | cut -f1)"
echo "输出目录:   $OUTPUT_DIR"
echo "输出名称:   $OUTPUT_NAME"
echo "PotreeConverter: $CONVERTER"
echo ""

# ---------- Step 0: 检查 libtbb ----------
echo "=== [0/5] 检查 PotreeConverter 依赖 ==="
ldd "$CONVERTER" | grep -E "libtbb|liblaszip"
echo ""

# ---------- Step 1: PCD → LAS (如果输入是 PCD) ----------
LAS_FILE=""
if [[ "$INPUT" == *.pcd ]]; then
    echo "=== [1/5] PCD → LAS ==="
    LAS_FILE="$(dirname "$INPUT")/$(basename "$INPUT" .pcd).las"

    # 先检查 PCD 头部
    echo "--- PCD 头部信息 ---"
    head -c 2000 "$INPUT" | strings | head -15
    echo ""

    echo "转换中..."
    $PCD2LAS "$INPUT" "$LAS_FILE"
    echo "LAS 文件: $LAS_FILE ($(du -h "$LAS_FILE" | cut -f1))"
    echo ""
elif [[ "$INPUT" == *.las ]] || [[ "$INPUT" == *.laz ]]; then
    LAS_FILE="$INPUT"
    echo "=== [1/5] 直接使用 LAS 文件 ==="
    echo "LAS 文件: $LAS_FILE ($(du -h "$LAS_FILE" | cut -f1))"
    echo ""
else
    echo "❌ 不支持的格式: $INPUT"
    exit 1
fi

# ---------- Step 2: 检查 LAS 文件点数 ----------
echo "=== [2/5] 检查 LAS 文件 ==="
python3 -c "
import laspy
las = laspy.read('$LAS_FILE')
n = len(las.X)
print(f'LAS 点数: {n:,}')
print(f'X 范围: [{las.X.min()}, {las.X.max()}] (尺度 {las.header.scales[0]})')
print(f'Y 范围: [{las.Y.min()}, {las.Y.max()}] (尺度 {las.header.scales[1]})')
print(f'Z 范围: [{las.Z.min()}, {las.Z.max()}] (尺度 {las.header.scales[2]})')
print(f'实际坐标 X: [{las.X.min()*las.header.scales[0]+las.header.offsets[0]:.2f}, {las.X.max()*las.header.scales[0]+las.header.offsets[0]:.2f}]')
print(f'实际坐标 Y: [{las.Y.min()*las.header.scales[1]+las.header.offsets[1]:.2f}, {las.Y.max()*las.header.scales[1]+las.header.offsets[1]:.2f}]')
print(f'实际坐标 Z: [{las.Z.min()*las.header.scales[2]+las.header.offsets[2]:.2f}, {las.Z.max()*las.header.scales[2]+las.header.offsets[2]:.2f}]')
print(f'Point format: {las.header.point_format.id}')
print(f'Has RGB: {\"red\" in las.point_format.dimensions}')
" 2>&1 || echo "⚠️ 无法读取 LAS 文件"
echo ""

# ---------- Step 3: PotreeConverter 转换 ----------
echo "=== [3/5] LAS → Potree (LAZ 格式) ==="
mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_DIR"/*

echo "命令: $CONVERTER $LAS_FILE -o $OUTPUT_DIR --output-format LAZ --attributes POSITION RGB"
echo "转换中...(可能需要几分钟)"
echo ""

"$CONVERTER" "$LAS_FILE" \
    -o "$OUTPUT_DIR" \
    --output-format LAZ \
    --attributes POSITION RGB \
    2>&1 || {
    echo "❌ PotreeConverter 失败,退出码 $?"
    echo "尝试不带 --attributes 参数..."
    "$CONVERTER" "$LAS_FILE" -o "$OUTPUT_DIR" 2>&1 || {
        echo "❌ 仍然失败"
        exit 1
    }
}

echo ""
echo "=== [4/5] 检查输出文件 ==="
ls -lah "$OUTPUT_DIR/"

# ---------- Step 5: 检查 metadata.json ----------
echo ""
echo "=== [5/5] 检查 metadata.json ==="
META="$OUTPUT_DIR/metadata.json"
if [ -f "$META" ]; then
    echo "--- metadata.json 内容 ---"
    cat "$META"
    echo ""
    echo ""

    # 提取点数
    POINTS=$(python3 -c "import json; d=json.load(open('$META')); print(d.get('points', 'N/A'))" 2>/dev/null || echo "N/A")
    echo "转换后点数: $POINTS"
    echo ""
    if [ "$POINTS" != "N/A" ] && [ "$POINTS" -lt 1000 ] 2>/dev/null; then
        echo "⚠️ 警告: 转换后点数极少 ($POINTS),可能存在库兼容性问题!"
    fi
else
    echo "❌ metadata.json 不存在!"
fi

echo ""
echo "============================================"
echo "  转换完成!"
echo "============================================"
echo ""
echo "前端加载 URL: /pointclouds/$OUTPUT_NAME/metadata.json"
echo "刷新前端,在点云列表中加载 $OUTPUT_NAME"
echo ""
echo "对比方法:"
echo "  1. 加载 industrial_area (API 转换的)"
echo "  2. 加载 $OUTPUT_NAME (本脚本转换的)"
echo "  3. 对比两个点云的显示效果和点数"
