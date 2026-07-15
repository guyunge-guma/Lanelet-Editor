/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Potree / THREE 全局声明(通过 script 标签加载,不在 npm 中)
// - Potree 1.8.2 自带 three.module.js,挂载到 window.THREE
declare global {
  interface Window {
    Potree: any;
    Potree_Utils: any;
    THREE: any;
  }
}

export {};
