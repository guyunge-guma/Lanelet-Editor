/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Potree 全局声明(通过 script 标签加载,不在 npm 中)
declare global {
  interface Window {
    Potree: any;
    Potree_Utils: any;
  }
}

export {};
