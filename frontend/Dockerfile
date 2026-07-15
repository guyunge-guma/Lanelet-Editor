# 多阶段构建: 先编译 Potree + 前端,再 nginx 部署
FROM node:20-alpine AS builder

# 换阿里云 alpine 源(加速 apk,如需装其他包)
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories

WORKDIR /app

# 使用本地已下载的 Potree_1.8.2.zip
# (请先把 zip 文件放到 frontend/ 目录下)
COPY Potree_1.8.2.zip /tmp/potree.zip

# busybox 自带 unzip,无需 apk 安装(省 ~160s)
RUN unzip -q /tmp/potree.zip -d /tmp/potree-extract \
    && mkdir -p /app/public/potree /app/public/libs \
    && cp -r /tmp/potree-extract/*/build/potree/* /app/public/potree/ \
    && cp -r /tmp/potree-extract/*/libs/* /app/public/libs/ \
    && rm -rf /tmp/potree.zip /tmp/potree-extract

# 补丁 potree.js: 暴露 Potree 内部 THREE.js 到 window.THREE
# 消除双 THREE 实例导致的 pick/dispose/事件兼容性问题
COPY patch_potree.js /app/patch_potree.js
RUN node /app/patch_potree.js /app/public/potree/potree.js

# 安装前端依赖(用 cache mount 加速重复构建)
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm config set registry https://registry.npmmirror.com \
    && npm install

COPY . .
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
