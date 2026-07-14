#!/bin/bash
# Lanelet Editor 一键启动脚本
# 用法:
#   ./start.sh           构建 + 启动
#   ./start.sh up        仅启动(已构建过)
#   ./start.sh down      停止
#   ./start.sh logs      查看日志
#   ./start.sh rebuild   强制重新构建

set -e

COMPOSE="docker compose"
DATA_DIR="./data"

# 创建数据目录
mkdir -p "$DATA_DIR/raw" "$DATA_DIR/pointclouds"

CMD=${1:-build-up}

case "$CMD" in
  build-up)
    echo "[1/2] 构建镜像..."
    $COMPOSE build
    echo "[2/2] 启动服务..."
    $COMPOSE up -d
    echo ""
    echo "✅ 启动成功"
    echo "   前端: http://localhost:8080"
    echo "   后端: http://localhost:8000/api/health"
    echo "   点云目录: $DATA_DIR/pointclouds/"
    ;;
  up)
    $COMPOSE up -d
    echo "✅ 已启动"
    ;;
  down)
    $COMPOSE down
    echo "✅ 已停止"
    ;;
  logs)
    $COMPOSE logs -f
    ;;
  rebuild)
    $COMPOSE down
    $COMPOSE build --no-cache
    $COMPOSE up -d
    echo "✅ 重新构建完成"
    ;;
  *)
    echo "用法: $0 {build-up|up|down|logs|rebuild}"
    exit 1
    ;;
esac
