/**
 * patch_potree.cjs
 *
 * Potree 1.8.2 的预构建 potree.js 是 UMD 格式,THREE.js r124 源码直接
 * 内联在 UMD 闭包内,所有类(Vector3, Ray, Box3 等)都是局部变量,不导出。
 *
 * 本脚本在 potree.js 末尾(exports 段)注入代码,用 eval 从闭包中收集
 * 所有 THREE.js 变量,导出为 exports.THREE。
 *
 * 这样 window.Potree.THREE 就是 Potree 内部使用的同一个 THREE 实例,
 * 应用代码直接使用它,彻底消除双 THREE 实例导致的兼容性问题。
 *
 * 用法: node patch_potree.cjs [potree.js路径]
 *
 * 注意: 使用 .cjs 扩展名确保在 ES module 项目中也能以 CommonJS 运行
 */
const fs = require('fs')

const filePath = process.argv[2] || './public/potree/potree.js'
let code = fs.readFileSync(filePath, 'utf8')

// 已打补丁则跳过
if (code.includes('exports.THREE = (function')) {
  console.log('[patch] potree.js 已打补丁,跳过')
  process.exit(0)
}

// THREE.js r124 完整导出列表(来自 src/Three.js)
// 包含: 常量、核心类、数学类、材质、几何体、曲线、辅助对象、加载器等
const threeNames = [
  // 常量
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
  'RGB_S3TC_DXT1_Format', 'RGBA_S3TC_DXT1_Format', 'RGBA_S3TC_DXT3_Format', 'RGBA_S3TC_DXT5_Format',
  'RGB_PVRTC_4BPPV1_Format', 'RGB_PVRTC_2BPPV1_Format', 'RGBA_PVRTC_4BPPV1_Format', 'RGBA_PVRTC_2BPPV1_Format',
  'RGB_ETC1_Format', 'RGB_ETC2_Format', 'RGBA_ETC2_EAC_Format', 'RGBA_ASTC_4x4_Format', 'RGBA_ASTC_5x4_Format',
  'RGBA_ASTC_5x5_Format', 'RGBA_ASTC_6x5_Format', 'RGBA_ASTC_6x6_Format', 'RGBA_ASTC_8x5_Format',
  'RGBA_ASTC_8x6_Format', 'RGBA_ASTC_8x8_Format', 'RGBA_ASTC_10x5_Format', 'RGBA_ASTC_10x6_Format',
  'RGBA_ASTC_10x8_Format', 'RGBA_ASTC_10x10_Format', 'RGBA_ASTC_12x10_Format', 'RGBA_ASTC_12x12_Format',
  'RGBA_BPTC_Format', 'RGB_BPTC_SIGNED_Format', 'RGB_BPTC_UNSIGNED_Format',
  'sRGBEncoding', 'LinearEncoding', 'SRGBColorSpace', 'LinearSRGBColorSpace',
  'InterpolateDiscrete', 'InterpolateLinear', 'InterpolateSmooth',
  'ZeroCurvatureEnding', 'ZeroSlopeEnding', 'WrapAroundEnding',
  'TrianglesDrawMode', 'TriangleStripDrawMode', 'TriangleFanDrawMode',
  'NormalAnimationBlendMode', 'AdditiveAnimationBlendMode',
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
  'Int8BufferAttribute', 'Uint8BufferAttribute', 'Uint8ClampedBufferAttribute',
  'Int16BufferAttribute', 'Uint16BufferAttribute', 'Int32BufferAttribute', 'Uint32BufferAttribute', 'Float64BufferAttribute',
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
  'TetrahedronGeometry', 'TetrahedronBufferGeometry', 'TorusGeometry', 'TorusBufferGeometry',
  'TorusKnotGeometry', 'TorusKnotBufferGeometry', 'TubeGeometry', 'TubeBufferGeometry', 'WireframeGeometry',
  // 对象
  'Scene', 'Mesh', 'InstancedMesh', 'Line', 'LineSegments', 'LineLoop', 'Points', 'Group', 'Sprite', 'LOD',
  'SkinnedMesh', 'Skeleton', 'Bone', 'ImmediateRenderObject',
  // 纹理
  'Texture', 'VideoTexture', 'DataTexture', 'DataTexture2DArray', 'DataTexture3D',
  'CompressedTexture', 'CubeTexture', 'CanvasTexture', 'DepthTexture',
  // 相机
  'Camera', 'PerspectiveCamera', 'OrthographicCamera', 'CubeCamera', 'ArrayCamera', 'StereoCamera',
  // 光源
  'Light', 'AmbientLight', 'DirectionalLight', 'PointLight', 'SpotLight', 'HemisphereLight',
  'LightProbe', 'AmbientLightProbe', 'HemisphereLightProbe', 'RectAreaLight',
  // 辅助对象
  'ArrowHelper', 'AxesHelper', 'BoxHelper', 'Box3Helper', 'CameraHelper',
  'DirectionalLightHelper', 'GridHelper', 'HemisphereLightHelper', 'PointLightHelper',
  'PolarGridHelper', 'SkeletonHelper', 'SpotLightHelper', 'PlaneHelper',
  // 渲染器
  'WebGLRenderer', 'WebGL1Renderer', 'WebGLRenderTarget', 'WebGLCubeRenderTarget', 'WebGLMultisampleRenderTarget',
  'ShaderLib', 'UniformsLib', 'UniformsUtils', 'ShaderChunk',
  'Fog', 'FogExp2',
  // 加载器
  'Loader', 'LoaderUtils', 'LoadingManager', 'DefaultLoadingManager', 'Cache', 'FileLoader',
  'ImageLoader', 'ImageBitmapLoader', 'TextureLoader', 'ObjectLoader', 'MaterialLoader',
  'BufferGeometryLoader', 'FontLoader', 'AnimationLoader', 'CompressedTextureLoader',
  'CubeTextureLoader', 'DataTextureLoader',
  // 曲线
  'Curve', 'CurvePath', 'Path', 'ShapePath', 'Shape', 'Font',
  'ArcCurve', 'CatmullRomCurve3', 'CubicBezierCurve', 'CubicBezierCurve3',
  'EllipseCurve', 'LineCurve', 'LineCurve3', 'QuadraticBezierCurve', 'QuadraticBezierCurve3', 'SplineCurve',
  // 动画
  'AnimationClip', 'AnimationMixer', 'AnimationObjectGroup', 'AnimationUtils',
  'KeyframeTrack', 'PropertyBinding', 'PropertyMixer',
  'BooleanKeyframeTrack', 'ColorKeyframeTrack', 'NumberKeyframeTrack', 'QuaternionKeyframeTrack',
  'StringKeyframeTrack', 'VectorKeyframeTrack',
  // 音频
  'Audio', 'AudioAnalyser', 'AudioContext', 'AudioListener', 'PositionalAudio',
  // 其他
  'DataUtils', 'ImageUtils', 'ShapeUtils', 'PMREMGenerator', 'WebGLUtils',
]

// 注入代码: 用 eval 安全地从闭包中收集所有 THREE.js 变量
// eval 在 strict mode 下可以读取闭包变量,只是不能创建新变量
const injection = `
	// ===== patch_potree.cjs 注入: 暴露 Potree 内部 THREE 到 exports.THREE =====
	exports.THREE = (function() {
		var three = {};
		var names = ${JSON.stringify(threeNames)};
		for (var i = 0; i < names.length; i++) {
			try {
				three[names[i]] = eval(names[i]);
			} catch(e) {
				// 变量在闭包中不存在,跳过
			}
		}
		return three;
	})();
	// ===== patch_potree.cjs 注入结束 =====`

// 找到注入位置: Object.defineProperty(exports, '__esModule', { value: true });
const target = "Object.defineProperty(exports, '__esModule', { value: true });"
const pos = code.indexOf(target)

if (pos === -1) {
  console.error('[patch] 错误: 找不到 "Object.defineProperty(exports, \'__esModule\'..." ')
  console.error('[patch] 请确认使用的是 Potree 1.8.2 预构建版本')
  process.exit(1)
}

code = code.slice(0, pos) + injection + '\n' + code.slice(pos)

fs.writeFileSync(filePath, code)

const foundCount = threeNames.length
console.log(`[patch] 成功: potree.js 已打补丁,注入 ${foundCount} 个 THREE.js 导出名`)
console.log('[patch] window.Potree.THREE 将暴露 Potree 内部 THREE 实例')
