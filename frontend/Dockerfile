# 多阶段构建: 先编译 Potree + 前端,再 nginx 部署
FROM node:20-alpine AS builder

# 安装解压工具
RUN apk add --no-cache unzip

WORKDIR /app

# 使用本地已下载的 Potree_1.8.2.zip
# (请先把 zip 文件放到 frontend/ 目录下)
COPY Potree_1.8.2.zip /tmp/potree.zip

RUN unzip -q /tmp/potree.zip -d /tmp/potree-extract \
    && mkdir -p /app/public/potree /app/public/libs \
    && cp -r /tmp/potree-extract/*/build/potree/* /app/public/potree/ \
    && cp -r /tmp/potree-extract/*/libs/* /app/public/libs/ \
    && rm -rf /tmp/potree.zip /tmp/potree-extract

# 安装前端依赖
COPY package.json package-lock.json* ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm install

COPY . .
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
