# 使用 miniconda 镜像: lanelet2 在 conda-forge 上维护最好
FROM continuumio/miniconda3:25.3.1-0

LABEL maintainer="lanelet-editor"

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 用 conda 安装 lanelet2(避免 pip 编译失败)
# 同时安装其他 Python 依赖
RUN conda install -y -c conda-forge \
    python=3.11 \
    lanelet2=1.2.1 \
    numpy \
    && conda clean -afy

# 复制依赖并安装
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY app ./app

# 数据目录(挂载卷)
RUN mkdir -p /app/data/raw /app/data/pointclouds
ENV DATA_DIR=/app/data
ENV POINTCLOUD_DIR=/app/data/pointclouds

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
