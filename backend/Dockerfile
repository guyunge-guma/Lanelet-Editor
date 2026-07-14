# 使用 miniconda 镜像: lanelet2 在 conda-forge 上预编译
FROM continuumio/miniconda3:latest

LABEL maintainer="lanelet-editor"

WORKDIR /app

# 配置 conda 国内源 + 启用 libmamba 加速依赖解析
RUN conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/main/ \
    && conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/free/ \
    && conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge/ \
    && conda config --set show_channel_urls yes \
    && conda config --set solver libmamba

# 用 libmamba 安装 lanelet2(依赖解析从几分钟降到秒级)
# 先装 mamba 加速器,再用 mamba 装 lanelet2
RUN conda install -y -n base -c conda-forge mamba python=3.11 \
    && conda clean -afy

RUN mamba install -y -c conda-forge lanelet2 numpy \
    && mamba clean -afy

# 配置 pip 国内源
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

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
