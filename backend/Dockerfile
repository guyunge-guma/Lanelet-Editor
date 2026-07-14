# 用 python slim 镜像(比 miniconda 小 10 倍)
# lanelet2 在 PyPI/GitHub 有预编译 wheel,无需 conda
FROM python:3.11-slim

LABEL maintainer="lanelet-editor"

WORKDIR /app

# 配置 pip 国内源
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

# 复制依赖并安装(含 fastapi/uvicorn 等)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 安装 lanelet2 预编译 wheel
# 优先从国内镜像下载,失败回退到 GitHub Release(用 gh-proxy 加速)
RUN pip install --no-cache-dir lanelet2 \
    || pip install --no-cache-dir \
        "https://gh-proxy.org/https://github.com/fzi-forschungszentrum-informatik/Lanelet2/releases/download/1.2.2/lanelet2-1.2.2-cp311-cp311-manylinux_2_31_x86_64.whl"

# 复制应用代码
COPY app ./app

# 数据目录(挂载卷)
RUN mkdir -p /app/data/raw /app/data/pointclouds
ENV DATA_DIR=/app/data
ENV POINTCLOUD_DIR=/app/data/pointclouds

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
