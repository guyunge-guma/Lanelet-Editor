# 使用 Python slim 镜像，比 miniconda 小很多
FROM python:3.11-slim

LABEL maintainer="lanelet-editor"

WORKDIR /app

# ---------- 配置 Debian apt 国内源(阿里云) ----------
# python:3.11-slim 基于 Debian 12 (bookworm),默认源在国外很慢
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
    || sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null \
    || true

# ---------- 系统依赖安装 ----------
# 注意: 故意不安装 libtbb-dev!
# PotreeConverter 在宿主机(RHEL 10)编译,链接的是宿主机的 libtbb.so.12。
# 宿主机的 libtbb.so.12 通过 build_potreeconverter.sh / fix_libtbb.sh 复制到
# /opt/potreeconverter/lib/ 并挂载到容器,确保 ABI 完全匹配。
# 如果容器内安装 Debian 版的 libtbb,会与 RHEL 编译的二进制 ABI 不兼容,
# 导致 TBB 并行处理静默失败,点位大幅丢失(259万点 → 几乎为空)。
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# ---------- Python 配置 ----------
# 配置 pip 国内源（清华大学镜像）
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

# 复制依赖文件并安装 Python 包（含 fastapi, uvicorn 等）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ---------- 安装 lanelet2（优先 PyPI，失败则从 GitHub Release 下载） ----------
RUN pip install --no-cache-dir lanelet2 \
    || pip install --no-cache-dir \
        "https://gh-proxy.org/https://github.com/fzi-forschungszentrum-informatik/Lanelet2/releases/download/1.2.2/lanelet2-1.2.2-cp311-cp311-manylinux_2_31_x86_64.whl"

# ---------- 复制应用代码 ----------
COPY app ./app

# ---------- 创建数据目录（挂载卷） ----------
RUN mkdir -p /app/data/raw /app/data/pointclouds
ENV DATA_DIR=/app/data
ENV POINTCLOUD_DIR=/app/data/pointclouds

# ---------- 设置 PotreeConverter 动态库路径 ----------
# 这里 PATH 包括了系统默认的 /usr/lib/x86_64-linux-gnu（即 libtbb 安装位置）
ENV LD_LIBRARY_PATH=/opt/potreeconverter/lib:/usr/local/lib:/usr/lib/x86_64-linux-gnu

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]