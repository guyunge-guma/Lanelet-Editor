/**
 * patch_potree.cjs
 *
 * Potree 1.8.2 的预构建 potree.js 是 UMD 格式,THREE.js r124 源码直接
 * 内联在 UMD 闭包内。部分 class 声明在嵌套块作用域内(brace depth 3+),
 * 文件末尾的 eval 无法访问它们(class 是块级作用域的)。
 *
 * 本脚本对每个 class/const 声明,在其结束后立即插入导出语句,
 * 确保导出代码与声明在同一个作用域内。
 *
 * 用法: node patch_potree.cjs [potree.js路径]
 */
const fs = require('fs')

const filePath = process.argv[2] || './public/potree/potree.js'
let code = fs.readFileSync(filePath, 'utf8')

// 已打补丁则跳过
if (code.includes('patch_potree.cjs 注入')) {
  console.log('[patch] potree.js 已打补丁,跳过')
  process.exit(0)
}

// THREE.js r124 完整导出列表
const threeNames = [
  'REVISION', 'MOUSE', 'TOUCH',
  'CullFaceNone', 'CullFaceBack', 'CullFaceFront', 'CullFaceFrontBack',
  'BasicShadowMap', 'PCFShadowMap', 'PCFSoftShadowMap', 'VSMShadowMap',
  'FrontSide', 'BackSide', 'DoubleSide',
  'FlatShading', 'SmoothShading',
  'NoBlending', 'NormalBlending', 'AdditiveBlending', 'SubtractiveBlending', 'MultiplyBlending', 'CustomBlending',
  'AddEquation', 'SubtractEquation', 'ReverseSubtractEquation', 'MinEquation', 'MaxEquation',
  'ZeroFactor', 'OneFactor', 'SrcColorFactor', 'OneMinusSrcColorFactor', 'SrcAlphaFactor', 'OneMinusSrcAlphaFactor',
  'DstAlphaFactor', 'OneMinusDstAlphaFactor', 'DstColorFactor', 'OneMinusDstColorFactor', 'SrcAlphaSaturateFactor',
  'NeverDepth', 'AlwaysDepth', 'LessDepth', 'LessEqualDepth', 'EqualDepth', 'GreaterEqualDepth', 'GreaterDepth', 'NotEqualDepth',
  'MultiplyOperation', 'MixOperation', 'AddOperation',
  'NoToneMapping', 'LinearToneMapping', 'ReinhardToneMapping', 'ACESFilmicToneMapping',
  'UVMapping', 'CubeReflectionMapping', 'CubeRefractionMapping', 'EquirectangularReflectionMapping',
  'EquirectangularRefractionMapping', 'SphericalReflectionMapping', 'CubeUVReflectionMapping', 'CubeUVRefractionMapping',
  'RepeatWrapping', 'ClampToEdgeWrapping', 'MirroredRepeatWrapping',
  'NearestFilter', 'NearestMipmapNearestFilter', 'NearestMipmapLinearFilter',
  'LinearFilter', 'LinearMipmapNearestFilter', 'LinearMipmapLinearFilter',
  'UnsignedByteType', 'ByteType', 'ShortType', 'UnsignedShortType', 'IntType', 'UnsignedIntType', 'FloatType',
  'HalfFloatType', 'UnsignedShort4444Type', 'UnsignedShort5551Type', 'UnsignedInt4444Type', 'UnsignedInt5551Type',
  'UnsignedInt5999Type', 'UnsignedInt1010102Type', 'UnsignedInt248Type',
  'AlphaFormat', 'RGBFormat', 'RGBAFormat', 'LuminanceFormat', 'LuminanceAlphaFormat',
  'RGBEFormat', 'DepthFormat', 'DepthStencilFormat',
  'RedFormat', 'RedIntegerFormat', 'RGFormat', 'RGIntegerFormat', 'RGBAIntegerFormat',
  'sRGBEncoding', 'LinearEncoding',
  'InterpolateDiscrete', 'InterpolateLinear', 'InterpolateSmooth',
  'ZeroCurvatureEnding', 'ZeroSlopeEnding', 'WrapAroundEnding',
  'TrianglesDrawMode', 'TriangleStripDrawMode', 'TriangleFanDrawMode',
  'BasicDepthPacking', 'RGBADepthPacking',
  'TangentSpaceNormalMap', 'ObjectSpaceNormalMap',
  'KeepStencilOp', 'ZeroStencilOp', 'ReplaceStencilOp', 'IncrementStencilOp', 'DecrementStencilOp',
  'IncrementWrapStencilOp', 'DecrementWrapStencilOp', 'InvertStencilOp',
  'NeverStencilFunc', 'AlwaysStencilFunc', 'LessStencilFunc', 'LessEqualStencilFunc',
  'GreaterStencilFunc', 'GreaterEqualStencilFunc', 'EqualStencilFunc', 'NotEqualStencilFunc',
  // 核心类
  'EventDispatcher', 'Object3D', 'Raycaster', 'Layers', 'Clock', 'Uniform',
  'BufferGeometry', 'InstancedBufferGeometry', 'Geometry',
  'BufferAttribute', 'Float32BufferAttribute',
  'InterleavedBuffer', 'InstancedInterleavedBuffer', 'InterleavedBufferAttribute',
  'InstancedBufferAttribute', 'GLBufferAttribute', 'Face3',
  // 数学类
  'Vector2', 'Vector3', 'Vector4', 'Quaternion', 'Color', 'Matrix3', 'Matrix4',
  'Box2', 'Box3', 'Sphere', 'Ray', 'Plane', 'Frustum', 'Line3', 'Euler',
  'Triangle', 'MathUtils', 'Spherical', 'Cylindrical', 'SphericalHarmonics3',
  'Interpolant', 'LinearInterpolant', 'DiscreteInterpolant', 'CubicInterpolant', 'QuaternionLinearInterpolant',
  // 材质
  'Material', 'MeshBasicMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshToonMaterial',
  'MeshNormalMaterial', 'MeshMatcapMaterial', 'MeshDepthMaterial', 'MeshDistanceMaterial',
  'MeshStandardMaterial', 'MeshPhysicalMaterial', 'RawShaderMaterial', 'ShaderMaterial',
  'LineBasicMaterial', 'LineDashedMaterial', 'PointsMaterial', 'SpriteMaterial', 'ShadowMaterial',
  // 几何体
  'BoxGeometry', 'BoxBufferGeometry', 'CircleGeometry', 'CircleBufferGeometry',
  'ConeGeometry', 'ConeBufferGeometry', 'CylinderGeometry', 'CylinderBufferGeometry',
  'DodecahedronGeometry', 'DodecahedronBufferGeometry', 'EdgesGeometry',
  'ExtrudeGeometry', 'ExtrudeBufferGeometry', 'IcosahedronGeometry', 'IcosahedronBufferGeometry',
  'LatheGeometry', 'LatheBufferGeometry', 'OctahedronGeometry', 'OctahedronBufferGeometry',
  'ParametricGeometry', 'ParametricBufferGeometry', 'PlaneGeometry', 'PlaneBufferGeometry',
  'PolyhedronGeometry', 'RingGeometry', 'RingBufferGeometry', 'ShapeGeometry', 'ShapeBufferGeometry',
  'SphereGeometry', 'SphereBufferGeometry',
  'TetrahedronGeometry', 'TetrahedronBufferGeometry', 'TorusGeometry', 'TorusBufferGeometry',
  'TorusKnotGeometry', 'TorusKnotBufferGeometry', 'TubeGeometry', 'TubeBufferGeometry', 'WireframeGeometry',
  // 对象
  'Scene', 'Mesh', 'InstancedMesh', 'Line', 'LineSegments', 'LineLoop', 'Points', 'Group', 'Sprite', 'LOD',
  'SkinnedMesh', 'Skeleton', 'Bone',
  // 纹理
  'Texture', 'VideoTexture', 'DataTexture', 'DataTexture2DArray', 'DataTexture3D',
  'CompressedTexture', 'CubeTexture', 'CanvasTexture', 'DepthTexture',
  // 相机
  'Camera', 'PerspectiveCamera', 'OrthographicCamera', 'CubeCamera', 'ArrayCamera', 'StereoCamera',
  // 光源
  'Light', 'AmbientLight', 'DirectionalLight', 'PointLight', 'SpotLight', 'HemisphereLight',
  // 辅助对象
  'ArrowHelper', 'AxesHelper', 'BoxHelper', 'Box3Helper', 'CameraHelper',
  'DirectionalLightHelper', 'GridHelper', 'HemisphereLightHelper', 'PointLightHelper',
  'PolarGridHelper', 'SkeletonHelper', 'SpotLightHelper', 'PlaneHelper',
  // 渲染器
  'WebGLRenderer', 'WebGL1Renderer', 'WebGLRenderTarget', 'WebGLCubeRenderTarget',
  'ShaderLib', 'UniformsLib', 'UniformsUtils', 'ShaderChunk',
  'Fog', 'FogExp2',
  // 加载器
  'Loader', 'LoaderUtils', 'LoadingManager', 'DefaultLoadingManager', 'Cache', 'FileLoader',
  // 曲线
  'Curve', 'CurvePath', 'Path', 'ShapePath', 'Shape', 'Font',
  'ArcCurve', 'CatmullRomCurve3', 'CubicBezierCurve', 'CubicBezierCurve3',
  'EllipseCurve', 'LineCurve', 'LineCurve3', 'QuadraticBezierCurve', 'QuadraticBezierCurve3', 'SplineCurve',
  // 动画
  'AnimationClip', 'AnimationMixer', 'AnimationObjectGroup', 'AnimationUtils',
  'KeyframeTrack', 'PropertyBinding', 'PropertyMixer',
  // 其他
  'DataUtils', 'ImageUtils', 'ShapeUtils',
]

/**
 * 在代码中查找匹配的闭合大括号
 * @param {string} code - 源代码
 * @param {number} startPos - 起始位置(指向 class 声明)
 * @returns {number} 闭合 } 的位置,或 -1
 */
function findClassEnd(code, startPos) {
  // 找到 class 后的第一个 {
  let braceStart = code.indexOf('{', startPos)
  if (braceStart === -1) return -1

  let depth = 0
  let i = braceStart
  let inString = false, stringChar = ''
  let inLineComment = false, inBlockComment = false

  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]

    if (inLineComment) { if (ch === '\n') inLineComment = false; i++; continue }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i += 2; continue } i++; continue }
    if (inString) {
      if (ch === '\\') { i += 2; continue }
      if (ch === stringChar) inString = false
      i++; continue
    }
    if (ch === '/' && next === '/') { inLineComment = true; i += 2; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; i += 2; continue }
    if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringChar = ch; i++; continue }

    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/**
 * 查找 const/let/var 声明的结束分号(在深度 0 处)
 */
function findStatementEnd(code, startPos) {
  let i = startPos
  let depth = 0
  let inString = false, stringChar = ''
  let inLineComment = false, inBlockComment = false

  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]

    if (inLineComment) { if (ch === '\n') inLineComment = false; i++; continue }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i += 2; continue } i++; continue }
    if (inString) {
      if (ch === '\\') { i += 2; continue }
      if (ch === stringChar) inString = false
      i++; continue
    }
    if (ch === '/' && next === '/') { inLineComment = true; i += 2; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; i += 2; continue }
    if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringChar = ch; i++; continue }

    if (ch === '{' || ch === '(' || ch === '[') depth++
    if (ch === '}' || ch === ')' || ch === ']') depth--
    if (ch === ';' && depth === 0) return i
    i++
  }
  return -1
}

// Step 1: 在 'use strict' 后初始化 exports.THREE
const strictStr = "'use strict';"
const strictPos = code.indexOf(strictStr)
if (strictPos === -1) {
  console.error('[patch] 错误: 找不到 \'use strict\'')
  process.exit(1)
}
const initInsertPos = strictPos + strictStr.length
code = code.slice(0, initInsertPos) +
  '\n\t// patch_potree.cjs 注入: 初始化 THREE 导出对象' +
  '\n\texports.THREE = exports.THREE || {};\n' +
  code.slice(initInsertPos)

// Step 2: 收集所有插入点
const insertions = []
let classCount = 0
let constCount = 0
let notFound = []

for (const name of threeNames) {
  const escapedName = name.replace(/\$/g, '\\$')

  // 查找 class XXX 声明
  const classPattern = new RegExp(`\\bclass\\s+${escapedName}\\b`)
  const classMatch = classPattern.exec(code)
  if (classMatch) {
    const classEnd = findClassEnd(code, classMatch.index)
    if (classEnd !== -1) {
      insertions.push({
        pos: classEnd + 1,
        code: `\n\texports.THREE['${name}'] = ${name}; // patch_potree.cjs`,
      })
      classCount++
      continue
    }
  }

  // 查找 function XXX( 声明(THREE.js r124 很多类编译为 function 构造器)
  const funcPattern = new RegExp(`\\bfunction\\s+${escapedName}\\s*\\(`)
  const funcMatch = funcPattern.exec(code)
  if (funcMatch) {
    const funcEnd = findClassEnd(code, funcMatch.index) // 同样用大括号匹配
    if (funcEnd !== -1) {
      insertions.push({
        pos: funcEnd + 1,
        code: `\n\texports.THREE['${name}'] = ${name}; // patch_potree.cjs`,
      })
      classCount++
      continue
    }
  }

  // 查找 const/let/var XXX = 声明
  const constPattern = new RegExp(`\\b(?:const|let|var)\\s+${escapedName}\\s*=`)
  const constMatch = constPattern.exec(code)
  if (constMatch) {
    const stmtEnd = findStatementEnd(code, constMatch.index)
    if (stmtEnd !== -1) {
      insertions.push({
        pos: stmtEnd + 1,
        code: `\n\texports.THREE['${name}'] = ${name}; // patch_potree.cjs`,
      })
      constCount++
      continue
    }
  }

  notFound.push(name)
}

// Step 3: 按位置降序排列(从后往前插入,不影响前面的位置)
insertions.sort((a, b) => b.pos - a.pos)

for (const ins of insertions) {
  code = code.slice(0, ins.pos) + ins.code + code.slice(ins.pos)
}

fs.writeFileSync(filePath, code)

console.log(`[patch] 成功: potree.js 已打补丁`)
console.log(`[patch]   class 导出: ${classCount}`)
console.log(`[patch]   const/let/var 导出: ${constCount}`)
console.log(`[patch]   未找到: ${notFound.length} (${notFound.slice(0, 10).join(', ')}${notFound.length > 10 ? '...' : ''})`)
console.log(`[patch]   总计: ${classCount + constCount} / ${threeNames.length}`)
console.log('[patch] window.Potree.THREE 将暴露 Potree 内部 THREE 实例')
