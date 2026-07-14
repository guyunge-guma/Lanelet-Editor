import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 后端 API 地址: 开发时走 vite 代理,生产时走 nginx
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/pointclouds': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  // potree 包的入口需要转译
  optimizeDeps: {
    include: ['three'],
  },
})
