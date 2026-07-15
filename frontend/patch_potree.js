/**
 * patch_potree.js
 *
 * Potree 1.8.2 的预构建 potree.js 是 webpack 4 打包的(非压缩版),
 * THREE.js 被打包在 webpack 模块闭包内,不暴露到 window。
 *
 * 本脚本在 webpack 模块系统中找到 three.module.js 的模块定义,
 * 在模块末尾注入 `window.THREE = __webpack_exports__;`,
 * 使 Potree 内部的 THREE 实例暴露为全局变量。
 *
 * 这样应用代码使用的 THREE 与 Potree 内部完全相同,
 * 彻底消除双实例导致的 pick/dispose/事件 兼容性问题。
 *
 * 用法: node patch_potree.js [potree.js路径]
 */
const fs = require('fs')

const filePath = process.argv[2] || './public/potree/potree.js'
let code = fs.readFileSync(filePath, 'utf8')

// 已打补丁则跳过
if (code.includes('window.THREE = __webpack_exports__')) {
  console.log('[patch] potree.js 已打补丁,跳过')
  process.exit(0)
}

// ---- 策略 1: 在 webpack 模块注释中找 three.module.js ----
// 非压缩 webpack 4 输出格式:
//   /***/ "./libs/three.js/build/three.module.js":
//   /*!****...****!*\
//     !*** ./libs/three.js/build/three.module.js ***!
//     \****...****/
//   /***/ (function(module, __webpack_exports__, __webpack_require__) {
//     "use strict";
//     ... 所有 THREE.js 代码 ...
//   /***/ }),
const markers = [
  '"./libs/three.js/build/three.module.js"',
  '"./node_modules/three/build/three.module.js"',
  'three.module.js',
]

let pos = -1
let usedMarker = ''
for (const marker of markers) {
  pos = code.indexOf(marker)
  if (pos !== -1) {
    usedMarker = marker
    break
  }
}

if (pos === -1) {
  console.error('[patch] 错误: 在 potree.js 中找不到 three.module.js')
  console.error('[patch] 请确认使用的是 Potree 1.8.2 非压缩预构建版本')
  process.exit(1)
}
console.log('[patch] 找到 THREE 模块标记:', usedMarker)

// 从标记位置向后找模块函数签名
const funcPatterns = [
  '(function(module, __webpack_exports__, __webpack_require__)',
  '(module, __webpack_exports__, __webpack_require__) =>',
]

let funcStart = -1
for (const pattern of funcPatterns) {
  funcStart = code.indexOf(pattern, pos)
  if (funcStart !== -1) break
}

if (funcStart === -1) {
  console.error('[patch] 错误: 找到模块标记但找不到函数签名,webpack 输出格式可能不同')
  process.exit(1)
}

// 找模块结束位置(webpack 用 /***/ 分隔模块)
// 跳过函数声明部分(至少 100 字符),找下一个 /***/
let searchPos = funcStart + 100
let moduleEnd = code.indexOf('/***/', searchPos)

if (moduleEnd === -1) {
  // 尝试另一种结束模式
  moduleEnd = code.indexOf('}),', searchPos)
  if (moduleEnd === -1) {
    console.error('[patch] 错误: 找不到模块结束位置')
    process.exit(1)
  }
}

// 注入: 在模块结束前暴露 __webpack_exports__ 到 window
const injection = '\n;window.THREE = __webpack_exports__;\n'
code = code.slice(0, moduleEnd) + injection + code.slice(moduleEnd)

fs.writeFileSync(filePath, code)
console.log('[patch] 成功: potree.js 已打补丁,window.THREE 将暴露 Potree 内部 THREE 实例')
