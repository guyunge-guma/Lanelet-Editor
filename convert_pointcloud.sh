#!/bin/bash
# 点云转换脚本: 把 PCD 转成 Potree 格式
#
# 用法:
#   ./convert_pointcloud.sh <input.pcd> [output_name]
#
# 依赖: Docker(自动拉取 PotreeConverter 镜像)

set -e

if [ $# -lt 1 ]; then
  echo "用法: $0 <input.pcd> [output_name]"
  echo "示例: $0 data/raw/road.pcd road_map"
  exit 1
fi

INPUT=$1
OUTPUT_NAME=${2:-$(basename "$INPUT" | sed 's/\.[^.]*$//')}
OUTPUT_DIR="$(pwd)/data/pointclouds/$OUTPUT_NAME"

mkdir -p "$OUTPUT_DIR"

echo "转换: $INPUT -> $OUTPUT_DIR"

docker run --rm \
  -v "$(pwd)/data:/data" \
  ghcr.io/potree/potreeconverter:latest \
  PotreeConverter "/data/raw/$(basename "$INPUT")" \
    -o "/data/pointclouds/$OUTPUT_NAME" \
    --output-format LAZ \
    --attributes POSITION RGB

echo ""
echo "✅ 转换完成"
echo "   前端加载 URL: /pointclouds/$OUTPUT_NAME/metadata.json"
echo "   刷新前端页面即可在点云列表看到"
