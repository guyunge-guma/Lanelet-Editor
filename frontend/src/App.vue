<template>
  <div class="app-container">
    <header class="app-header">
      <h1>Lanelet Editor</h1>
      <span class="status" :class="{ ok: health?.status === 'ok' }">
        {{ health ? (health.status === 'ok' ? '在线' : '异常') : '连接中...' }}
      </span>
      <span v-if="health" class="ll-status">
        lanelet2: {{ health.lanelet2_available ? '可用' : '未安装' }}
      </span>
    </header>
    <main class="app-main">
      <MapView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import MapView from './views/MapView.vue'
import { getHealth } from './api'

const health = ref<Awaited<ReturnType<typeof getHealth>>>(null)

async function refreshHealth() {
  try {
    health.value = await getHealth()
  } catch {
    health.value = null
  }
}

onMounted(refreshHealth)
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: #2c3e50;
  color: #fff;
  height: 48px;
  flex-shrink: 0;
}

.app-header h1 {
  font-size: 16px;
  font-weight: 500;
}

.app-header .status {
  padding: 2px 8px;
  border-radius: 4px;
  background: #e6a23c;
  font-size: 12px;
}

.app-header .status.ok {
  background: #67c23a;
}

.app-header .ll-status {
  font-size: 12px;
  opacity: 0.8;
}

.app-main {
  flex: 1;
  overflow: hidden;
}
</style>
