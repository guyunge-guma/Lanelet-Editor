# 多阶段构建: 先编译 Potree + 前端,再 nginx 部署
FROM node:20-alpine AS builder

# 换阿里云 alpine 源(加速 apk,如需装其他包)
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories

# 安装 git(用于 clone Potree 源码)
RUN apk add --no-cache git

WORKDIR /app

# ---- 从源码构建 Potree 1.8.2(暴露内部 THREE,消除双实例问题) ----
# 优雅方案: 在入口 src/Potree.js 加一行 export { THREE },
# rollup 自动解析所有模块的 THREE 引用并统一导出
RUN git clone --depth 1 --branch 1.8.2 https://gh-proxy.org/https://github.com/potree/potree.git /tmp/potree-src \
    && cd /tmp/potree-src \
    && npm config set registry https://registry.npmmirror.com \
    && npm install --ignore-scripts \
    # 在入口文件添加 THREE 导出(rollup 会自动解析并去重)
    && sed -i '1i import * as THREE from "../libs/three.js/build/three.module.js"; export { THREE };' src/Potree.js \
    # 构建: gulp build 生成 shaders/workers/resources, rollup 打包 potree.js
    && npx gulp build \
    && npx rollup -c \
    && mkdir -p /app/public/potree /app/public/libs \
    && cp -r build/potree/* /app/public/potree/ \
    && cp -r libs/* /app/public/libs/ \
    && rm -rf /tmp/potree-src

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
