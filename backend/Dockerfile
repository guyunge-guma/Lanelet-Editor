# 使用 miniconda 镜像: lanelet2 在 conda-forge 上预编译,无需编译工具
FROM continuumio/miniconda3:latest

LABEL maintainer="lanelet-editor"

WORKDIR /app

# 配置 conda 国内源(加速 lanelet2 安装)
RUN conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/main/ \
    && conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/free/ \
    && conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge/ \
    && conda config --set show_channel_urls yes

# 用 conda 安装 lanelet2(预编译包,无需 build-essential)
RUN conda install -y -c conda-forge \
    python=3.11 \
    lanelet2 \
    numpy \
    && conda clean -afy

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
