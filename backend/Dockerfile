# 使用 miniconda 镜像: lanelet2 在 conda-forge 上预编译
FROM continuumio/miniconda3:latest

LABEL maintainer="lanelet-editor"

WORKDIR /app

# 只用 conda-forge 一个 channel(减少 repodata 下载量)
# 用清华镜像加速
RUN conda config --remove-key channels 2>/dev/null; \
    conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge/ \
    && conda config --set show_channel_urls yes \
    && conda config --set solver libmamba

# 先单独装 mamba(小包,快)
RUN conda install -y -n base -c https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge/ mamba \
    && conda clean -afy

# 用 mamba 装 lanelet2(libmamba solver,秒级解析)
RUN mamba install -y -c https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge/ \
    python=3.11 lanelet2 numpy \
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
