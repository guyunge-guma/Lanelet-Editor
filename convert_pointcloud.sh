#!/bin/bash
# 点云转换脚本: 把 PCD 转成 Potree 格式
#
# 用法:
#   ./convert_pointcloud.sh <input.pcd> [output_name]
#
# 依赖: PotreeConverter(用 build_potreeconverter.sh 一次性编译)

set -e

CONVERTER=/opt/potreeconverter/PotreeConverter

if [ ! -f "$CONVERTER" ]; then
    echo "❌ PotreeConverter 未安装"
    echo "   请先运行: ./build_potreeconverter.sh"
    exit 1
fi

if [ $# -lt 1 ]; then
    echo "用法: $0 <input.pcd> [output_name]"
    echo "示例: $0 data/raw/industrial_area.pcd industrial_area"
    exit 1
fi

INPUT=$1
OUTPUT_NAME=${2:-$(basename "$INPUT" | sed 's/\.[^.]*$//')}
OUTPUT_DIR="$(pwd)/data/pointclouds/$OUTPUT_NAME"

if [ ! -f "$INPUT" ]; then
    echo "❌ 输入文件不存在: $INPUT"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "转换: $INPUT -> $OUTPUT_DIR"
echo ""

"$CONVERTER" "$INPUT" -o "$OUTPUT_DIR" \
    --output-format LAZ \
    --attributes POSITION RGB

echo ""
echo "✅ 转换完成"
echo "   前端加载 URL: /pointclouds/$OUTPUT_NAME/metadata.json"
echo "   刷新前端页面即可在点云列表看到 $OUTPUT_NAME"
