/**
 * DrawingManager
 * Potree 点云拾取 + LineString 绘制管理器
 *
 * 职责:
 *  1. 在 Potree 渲染的 canvas 上监听鼠标事件,通过射线检测拾取点云坐标
 *  2. 维护"正在绘制"的折线:锚点(红色小球)+ 预览线(绿色)
 *  3. 完成绘制后生成最终 LineString(Three.js Line),按类型着色
 *  4. 绘制模式下禁用 Potree 默认相机交互(旋转/平移),非绘制模式恢复
 *  5. 始终追踪鼠标悬停的点云坐标,供状态栏显示
 *
 * Potree / THREE 均通过 window 全局加载,不在 npm 中,这里只用 any 类型访问。
 */

/** 鼠标拾取到的 3D 坐标(给状态栏用) */
export interface MousePos {
  x: number
  y: number
  z: number
}

/** LineString 类型 -> Three.js 颜色值(0xRRGGBB) */
export const TYPE_COLORS: Record<string, number> = {
  line_thin: 0x0066ff, // 蓝色
  line_thick: 0x0066ff, // 蓝色
  curbstone: 0xff6600, // 橙色
  virtual: 0x999999, // 灰色
  road_border: 0xff0000, // 红色
}

/** LineString 类型中文标签(给面板图例用) */
export const TYPE_LABELS: Record<string, string> = {
  line_thin: '细线',
  line_thick: '粗线',
  curbstone: '路沿',
  virtual: '虚拟线',
  road_border: '道路边界',
}

/** LineString 各类型对应的子类型选项(供两个面板共用,确保标签一致) */
export const LINESTRING_SUBTYPE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  line_thin: [
    { value: 'solid', label: '实线' },
    { value: 'dashed', label: '虚线' },
    { value: 'dotted', label: '点线' },
  ],
  line_thick: [
    { value: 'solid', label: '实线' },
    { value: 'dashed', label: '虚线' },
    { value: 'dotted', label: '点线' },
  ],
  curbstone: [
    { value: 'low', label: '低路沿' },
    { value: 'high', label: '高路沿' },
  ],
  virtual: [],
  road_border: [
    { value: 'solid', label: '实线' },
    { value: 'dashed', label: '虚线' },
  ],
}

/** 查找 LineString 子类型的中文标签 */
export function lineSubtypeLabel(type: string, subtype: string): string {
  const opts = LINESTRING_SUBTYPE_OPTIONS[type] ?? []
  return opts.find(o => o.value === subtype)?.label ?? subtype
}

/** Lanelet subtype -> Three.js 颜色值(0xRRGGBB) */
export const LANELET_SUBTYPE_COLORS: Record<string, number> = {
  road: 0x00ff00, // 绿色
  urban: 0x0066ff, // 蓝色
  intersection: 0xffff00, // 黄色
  speed_bump: 0xff0000, // 红色
}

/** Lanelet subtype 中文标签 */
export const LANELET_SUBTYPE_LABELS: Record<string, string> = {
  road: '道路',
  urban: '城市',
  intersection: '交叉口',
  speed_bump: '减速带',
}

/** Regulatory Element 类型 -> Three.js 颜色值(0xRRGGBB) */
export const REGULATORY_TYPE_COLORS: Record<string, number> = {
  traffic_light: 0xff2222, // 红色(与红绿灯主体一致)
  stop_line: 0xffffff, // 白色
  crosswalk: 0xffcc00, // 黄色斑马线
  traffic_sign: 0x2196f3, // 蓝色
}

/** Regulatory Element 类型中文标签 */
export const REGULATORY_TYPE_LABELS: Record<string, string> = {
  traffic_light: '红绿灯',
  stop_line: '停止线',
  crosswalk: '斑马线',
  traffic_sign: '交通标志',
}

/** 红绿灯默认颜色选项 */
export const TRAFFIC_LIGHT_STATE_COLORS: Record<string, number> = {
  red: 0xff0000,
  yellow: 0xffaa00,
  green: 0x00ff00,
}

/** 撤销/重做历史记录条目 */
export interface HistoryEntry {
  /** 操作类型 */
  type: 'add_point' | 'finish_line' | 'delete_line' | 'add_lanelet' | 'delete_lanelet' | 'set_direction' | 'batch_delete' | 'batch_type'
  /** 人类可读描述 */
  description: string
  /** 撤销操作 */
  undo: () => void
  /** 重做操作 */
  redo: () => void
}

/** 预览线缓冲区最大点数(足够绘制超长折线) */
const MAX_PREVIEW_POINTS = 10000
/** 锚点半径(米) */
const ANCHOR_RADIUS = 0.3
/** 去重阈值:连续两点距离小于此值视为同一点(处理双击重复点) */
const DEDUP_EPSILON = 0.01
/** 鼠标悬停拾取节流间隔(毫秒) */
const HOVER_THROTTLE_MS = 40

/** 已完成线段的内部记录 */
interface FinishedLine {
  /** 内部自增 id(前端使用,与后端 id 解耦) */
  id: number
  line: any // THREE.Line
  geometry: any // THREE.BufferGeometry
  material: any // THREE.LineBasicMaterial
  type: string
  subtype: string
  coords: number[]
}

/** Lanelet 可视化记录(半透明面片 + 方向箭头) */
interface LaneletMesh {
  /** Lanelet 后端 id */
  id: number
  /** 半透明面片 Mesh */
  mesh: any
  /** 面片几何体 */
  geometry: any
  /** 面片材质 */
  material: any
  /** 方向箭头(多个,沿路径轨迹分布) */
  arrows: any[]
  /** 基础方向向量(forward 方向,用于切换方向时计算) */
  baseDir: any // THREE.Vector3
  /** 当前方向 */
  direction: 'forward' | 'backward'
  /** 基础颜色(用于高亮恢复) */
  baseColor: number
  /** 基础不透明度(用于高亮恢复) */
  baseOpacity: number
}

/** 红绿灯可视化记录(红色圆柱体 + 朝向箭头 + 顶端小球) */
interface TrafficLightMesh {
  /** 红绿灯后端 id */
  id: number
  /** 主圆柱体 Mesh */
  mesh: any
  /** 圆柱体几何体 */
  geometry: any
  /** 圆柱体材质 */
  material: any
  /** 朝向箭头(ArrowHelper) */
  arrow: any
  /** 顶端发光小球(灯泡) */
  bulb: any
  /** 灯泡材质 */
  bulbMaterial: any
  /** 基础颜色(用于高亮恢复) */
  baseColor: number
}

/** 停止线可视化记录(粗白色线段) */
interface StopLineMesh {
  /** 停止线后端 id */
  id: number
  /** 线段对象 */
  line: any
  /** 几何体 */
  geometry: any
  /** 材质(LineBasicMaterial,较粗) */
  material: any
}

export class DrawingManager {
  private viewer: any
  private THREE: any

  /** 是否处于绘制模式 */
  private isDrawing = false
  /** 当前绘制的类型 / 子类型 */
  private currentType = ''
  private currentSubtype = ''

  /** 当前折线的锚点(THREE.Vector3 数组) */
  private points: any[] = []
  /** 当前折线的锚点 Mesh 数组(与 points 一一对应) */
  private anchorMeshes: any[] = []
  /** 预览线(THREE.Line) */
  private previewLine: any = null
  /** 预览线材质(绿色) */
  private previewLineMaterial: any = null
  /** 预览线缓冲区(Float32Array) */
  private previewPositions: Float32Array | null = null
  /** 当前鼠标位置(用于预览线末端) */
  private currentMousePos: any = null

  // ---------------- 吸附(Snapping) ----------------
  /** 是否启用吸附 */
  private snapEnabled = false
  /** 吸附阈值(米) */
  private snapThreshold = 1.5
  /** 当前吸附目标点(吸附生效时非 null) */
  private snapTarget: any = null
  /** 吸附指示器(高亮球体) */
  private snapIndicator: any = null
  /** 吸附指示器几何体(复用) */
  private snapIndicatorGeometry: any = null
  /** 吸附指示器材质(复用) */
  private snapIndicatorMaterial: any = null

  /** 共享的锚点几何体 / 材质(绘制期间复用,退出时统一释放) */
  private anchorGeometry: any = null
  private anchorMaterial: any = null

  /** 已完成线段:id -> 记录 */
  private finishedLines: Map<number, FinishedLine> = new Map()
  /** 下一条线段的内部 id */
  private nextLineId = 1

  /** Lanelet 可视化:id -> 记录(键为后端 Lanelet id) */
  private laneletMeshes: Map<number, LaneletMesh> = new Map()

  /** 红绿灯可视化:id -> 记录(键为后端 TrafficLight id) */
  private trafficLightMeshes: Map<number, TrafficLightMesh> = new Map()

  /** 停止线可视化:id -> 记录(键为后端 StopLine id) */
  private stopLineMeshes: Map<number, StopLineMesh> = new Map()

  /** 是否处于单点拾取模式(用于红绿灯放置等) */
  private isPicking = false

  /** 前端内部线段 id -> 后端 LineString id 的映射(由 MapView 注入) */
  lineIdMap?: Map<number, number>

  /** 上次悬停拾取时间戳(节流) */
  private lastHoverTime = 0

  /** 保存进入绘制模式前 Potree inputHandler 的 enabled 状态,退出时恢复 */
  private prevInputEnabled: boolean | undefined = undefined

  /** 绑定后的事件处理函数引用(便于移除监听) */
  private boundMouseMove: (e: MouseEvent) => void
  private boundMouseDown: (e: MouseEvent) => void
  private boundMouseUp: (e: MouseEvent) => void
  private boundDblClick: (e: MouseEvent) => void
  private boundContextMenu: (e: MouseEvent) => void
  private boundKeyDown: (e: KeyboardEvent) => void

  /** mousedown 时记录的坐标,用于 mouseup 判断是否为简单点击(非拖拽) */
  private mouseDownX = 0
  private mouseDownY = 0

  /** 标注是否置顶显示(默认 true,穿透点云) */
  annotationOnTop = true

  // ---------------- 撤销/重做历史栈 ----------------
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private static readonly MAX_HISTORY = 50
  /** 历史栈变化时触发,通知 UI 更新按钮状态 */
  onHistoryChanged?: () => void

  // ---------------- 回调(单一订阅者) ----------------
  /** 锚点添加时触发,参数为当前所有锚点的扁平坐标 [x0,y0,z0,...] */
  onPointAdded?: (points: number[]) => void
  /** 线段完成时触发,携带内部 id 供宿主做后端持久化映射 */
  onLineFinished?: (coords: number[], type: string, subtype: string, id: number) => void
  /** 线段被删除时触发(撤销/重做也会调用) */
  onLineDeleted?: (id: number) => void
  /** 点碰撞或区域碰撞时触发,参数为提示消息 */
  onCollision?: (message: string) => void
  /** 绘制模式切换时触发 */
  onModeChanged?: (isDrawing: boolean) => void
  /** 鼠标悬停在点云上时触发(坐标显示);离开点云时传 null */
  onMouseMove?: (pos: MousePos | null) => void
  /**
   * 单点拾取模式下,左键点击命中点云时触发一次,随后自动退出拾取模式。
   * 用于红绿灯放置等"点击取点"场景。
   */
  onPointPicked?: (pos: MousePos) => void

  // ---------------- 撤销/重做公共方法 ----------------

  /** 记录一个操作到历史栈(清空 redoStack) */
  pushHistory(entry: HistoryEntry): void {
    this.undoStack.push(entry)
    // 限制栈大小
    if (this.undoStack.length > DrawingManager.MAX_HISTORY) {
      this.undoStack.shift()
    }
    this.redoStack = []
    this.onHistoryChanged?.()
  }

  /** 执行撤销,返回是否成功 */
  undo(): boolean {
    const entry = this.undoStack.pop()
    if (!entry) return false
    try {
      entry.undo()
    } catch (e) {
      console.error('[DrawingManager] undo failed:', e)
    }
    this.redoStack.push(entry)
    this.onHistoryChanged?.()
    return true
  }

  /** 执行重做,返回是否成功 */
  redo(): boolean {
    const entry = this.redoStack.pop()
    if (!entry) return false
    try {
      entry.redo()
    } catch (e) {
      console.error('[DrawingManager] redo failed:', e)
    }
    this.undoStack.push(entry)
    this.onHistoryChanged?.()
    return true
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }

  /** 清空历史栈 */
  clearHistory(): void {
    this.undoStack = []
    this.redoStack = []
    this.onHistoryChanged?.()
  }

  constructor(viewer: any, THREE: any) {
    this.viewer = viewer
    this.THREE = THREE

    this.boundMouseMove = this.handleMouseMove.bind(this)
    this.boundMouseDown = this.handleMouseDown.bind(this)
    this.boundMouseUp = this.handleMouseUp.bind(this)
    this.boundDblClick = this.handleDblClick.bind(this)
    this.boundContextMenu = this.handleContextMenu.bind(this)
    this.boundKeyDown = this.handleKeyDown.bind(this)

    // 鼠标悬停拾取始终开启(供状态栏显示坐标),使用捕获阶段监听
    // 非绘制模式下不阻止冒泡,Potree 相机交互正常工作
    const dom = this.getDomElement()
    if (dom) {
      dom.addEventListener('mousemove', this.boundMouseMove, true)
      // 始终屏蔽 canvas 上的系统右键菜单(utools / 浏览器默认菜单)
      dom.addEventListener('contextmenu', this.boundContextMenu, true)
    }
  }

  // ============================================================
  //  公开 API
  // ============================================================

  /** 进入绘制模式 */
  startDrawing(type: string, subtype: string): void {
    if (!this.viewer) return
    // 已在绘制中,先清空当前未完成的线
    if (this.isDrawing) {
      this.clearCurrentDrawing()
    }

    this.isDrawing = true
    this.currentType = type
    this.currentSubtype = subtype
    this.points = []
    this.anchorMeshes = []
    this.currentMousePos = null

    // 创建共享锚点资源
    this.anchorGeometry = new this.THREE.SphereGeometry(ANCHOR_RADIUS, 16, 16)
    this.anchorMaterial = new this.THREE.MeshBasicMaterial({
      color: 0xff0000,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    })

    // 创建预览线
    this.previewPositions = new Float32Array(MAX_PREVIEW_POINTS * 3)
    const previewGeometry = new this.THREE.BufferGeometry()
    previewGeometry.setAttribute(
      'position',
      new this.THREE.BufferAttribute(this.previewPositions, 3),
    )
    previewGeometry.setDrawRange(0, 0)
    previewGeometry.computeBoundingSphere()
    this.previewLineMaterial = new this.THREE.LineBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
    })
    this.previewLine = new this.THREE.Line(previewGeometry, this.previewLineMaterial)
    this.previewLine.renderOrder = 998
    this.previewLine.visible = false
    this.previewLine.frustumCulled = false
    this.threeScene.add(this.previewLine)

    // 禁用 Potree 默认相机交互
    this.disablePotreeNavigation()

    // 注册绘制期事件(捕获阶段,阻止冒泡以屏蔽 Potree)
    const dom = this.getDomElement()
    if (dom) {
      // 拦截左键 mousedown,防止 Potree InputHandler 启动旋转
      dom.addEventListener('mousedown', this.boundMouseDown, true)
      // mouseup 检测简单点击(非拖拽),用于放置锚点
      dom.addEventListener('mouseup', this.boundMouseUp, true)
      dom.addEventListener('dblclick', this.boundDblClick, true)
      // contextmenu 已在构造函数中始终注册,无需重复
    }
    window.addEventListener('keydown', this.boundKeyDown, true)

    this.onModeChanged?.(true)
  }

  /** 退出绘制模式(丢弃当前未完成的线) */
  stopDrawing(): void {
    if (!this.isDrawing) return
    this.isDrawing = false

    // 移除绘制期事件
    const dom = this.getDomElement()
    if (dom) {
      dom.removeEventListener('mousedown', this.boundMouseDown, true)
      dom.removeEventListener('mouseup', this.boundMouseUp, true)
      dom.removeEventListener('dblclick', this.boundDblClick, true)
      // contextmenu 始终保留(构造函数中注册)
    }
    window.removeEventListener('keydown', this.boundKeyDown, true)

    // 清理当前未完成线
    this.clearCurrentDrawing()

    // 释放共享锚点资源
    // safeDispose 用 try-catch 包裹,即使 dispose 触发异常也不中断退出流程
    this.safeDispose(this.anchorGeometry, 'anchorGeometry')
    this.anchorGeometry = null
    this.safeDispose(this.anchorMaterial, 'anchorMaterial')
    this.anchorMaterial = null

    // 释放预览线
    if (this.previewLine) {
      this.safeRemoveFromScene(this.previewLine)
      this.safeDispose(this.previewLine.geometry, 'previewLine.geometry')
      this.previewLine = null
    }
    this.safeDispose(this.previewLineMaterial, 'previewLineMaterial')
    this.previewLineMaterial = null
    this.previewPositions = null

    // 清理吸附指示器
    this.hideSnapIndicator()
    this.disposeSnapIndicator()

    // 恢复 Potree 相机交互
    this.enablePotreeNavigation()

    this.onModeChanged?.(false)
  }

  /** 撤销最后一个锚点 */
  undoLastPoint(): void {
    if (!this.isDrawing || this.points.length === 0) return
    this.points.pop()
    const mesh = this.anchorMeshes.pop()
    if (mesh) {
      this.threeScene.remove(mesh)
      // 锚点共用 geometry/material,这里不单独 dispose
    }
    this.updatePreview()
    this.hideSnapIndicator()
    this.onPointAdded?.(this.getFlatCoords())
  }

  /**
   * 完成当前线段
   * - 至少需要 2 个有效点(自动去重双击产生的重复点)
   * - 完成后保留绘制模式,可继续画下一条
   * @returns 扁平坐标数组;点数不足时返回 null
   */
  finishLine(): number[] | null {
    if (!this.isDrawing) return null

    // 去重:连续距离极近的点视为同一点(双击会触发两次 click 产生重复点)
    const deduped = this.dedupePoints(this.points)
    if (deduped.length < 2) {
      // 点数不足,不算完成,仅清空当前未完成线,继续绘制
      this.clearCurrentDrawing()
      return null
    }

    const coords: number[] = []
    for (const p of deduped) {
      coords.push(p.x, p.y, p.z)
    }

    // 创建最终线段对象
    const color = TYPE_COLORS[this.currentType] ?? 0x00ff00
    const geometry = new this.THREE.BufferGeometry().setFromPoints(deduped)
    const material = new this.THREE.LineBasicMaterial({
      color,
      linewidth: 2,
    })
    const line = new this.THREE.Line(geometry, material)
    line.renderOrder = 999
    this.threeScene.add(line)

    const id = this.nextLineId++
    this.finishedLines.set(id, {
      id,
      line,
      geometry,
      material,
      type: this.currentType,
      subtype: this.currentSubtype,
      coords,
    })

    // 记录到历史栈
    const savedType = this.currentType
    const savedSubtype = this.currentSubtype
    this.pushHistory({
      type: 'finish_line',
      description: `完成线段 #${id}`,
      undo: () => {
        // 撤销: 移除线段(不通知后端,仅前端)
        this.safeRemoveFromScene(line)
        this.safeDispose(geometry, 'undo.geometry')
        this.safeDispose(material, 'undo.material')
        this.finishedLines.delete(id)
        this.onLineDeleted?.(id)
      },
      redo: () => {
        // 重做: 重新添加
        this.threeScene.add(line)
        this.finishedLines.set(id, {
          id, line, geometry, material,
          type: savedType, subtype: savedSubtype, coords,
        })
        this.onLineFinished?.(coords, savedType, savedSubtype, id)
      },
    })

    // 清空当前未完成线,保留绘制模式以便继续画下一条
    this.clearCurrentDrawing()

    this.onLineFinished?.(coords, this.currentType, this.currentSubtype, id)
    return coords
  }

  /** 取消当前未完成的线(保留绘制模式,可重新开始画) */
  cancelDrawing(): void {
    if (!this.isDrawing) return
    this.clearCurrentDrawing()
    this.onPointAdded?.(this.getFlatCoords())
  }

  /** 删除一条已完成的线段(按内部 id) */
  removeFinishedLine(id: number): void {
    const entry = this.finishedLines.get(id)
    if (!entry) return

    // 保存副本用于撤销
    const savedEntry = { ...entry }
    this.safeRemoveFromScene(entry.line)
    this.safeDispose(entry.geometry, 'finishedLine.geometry')
    this.safeDispose(entry.material, 'finishedLine.material')
    this.finishedLines.delete(id)

    // 记录到历史栈
    this.pushHistory({
      type: 'delete_line',
      description: `删除线段 #${id}`,
      undo: () => {
        // 撤销: 重新创建线段
        const geometry = new this.THREE.BufferGeometry().setFromPoints(
          this.parseCoords(savedEntry.coords)
        )
        const material = new this.THREE.LineBasicMaterial({
          color: TYPE_COLORS[savedEntry.type] ?? 0x00ff00,
          linewidth: 2,
        })
        const line = new this.THREE.Line(geometry, material)
        line.renderOrder = 999
        this.threeScene.add(line)
        this.finishedLines.set(id, {
          id, line, geometry, material,
          type: savedEntry.type, subtype: savedEntry.subtype, coords: savedEntry.coords,
        })
        this.onLineFinished?.(savedEntry.coords, savedEntry.type, savedEntry.subtype, id)
      },
      redo: () => {
        const e = this.finishedLines.get(id)
        if (!e) return
        this.safeRemoveFromScene(e.line)
        this.safeDispose(e.geometry, 'redo.geometry')
        this.safeDispose(e.material, 'redo.material')
        this.finishedLines.delete(id)
        this.onLineDeleted?.(id)
      },
    })
  }

  /** 清空所有已完成的线段 */
  clearAllFinishedLines(): void {
    for (const id of Array.from(this.finishedLines.keys())) {
      this.removeFinishedLine(id)
    }
  }

  /** 清空所有标注(线段 + Lanelet + 红绿灯 + 停止线) */
  clearAll(): void {
    this.clearAllFinishedLines()
    this.clearAllLaneletMeshes()
    this.clearAllTrafficLightMeshes()
    this.clearAllStopLineMeshes()
    this.clearHistory()
  }

  /** 从后端数据恢复一条已完成线段(不触发 onLineFinished 回调) */
  addFinishedLine(coords: number[], type: string, subtype: string): number {
    if (!this.THREE) return -1

    const points = this.parseCoords(coords)
    if (points.length < 2) return -1

    const geometry = new this.THREE.BufferGeometry().setFromPoints(points)
    const color = TYPE_COLORS[type] ?? 0x00ff00
    const material = new this.THREE.LineBasicMaterial({ color, linewidth: 2 })
    material.depthTest = !this.annotationOnTop
    const line = new this.THREE.Line(geometry, material)
    line.renderOrder = 999
    this.threeScene.add(line)

    const id = this.nextLineId++
    this.finishedLines.set(id, {
      id,
      line,
      geometry,
      material,
      type,
      subtype,
      coords,
    })
    return id
  }

  /** 获取已完成线段数量 */
  getFinishedCount(): number {
    return this.finishedLines.size
  }

  /**
   * 更新指定线段的颜色(批量改类型时调用)
   * @param id 线段内部 id
   * @param color Three.js 颜色值(0xRRGGBB)
   */
  updateLineColor(id: number, color: number): void {
    const entry = this.finishedLines.get(id)
    if (!entry) return
    entry.material.color.setHex(color)
    entry.material.needsUpdate = true
  }

  /**
   * 批量更新线段颜色
   * @param ids 线段内部 id 数组
   * @param colors 与 ids 一一对应的颜色值数组(0xRRGGBB)
   */
  batchUpdateLineColors(ids: number[], colors: number[]): void {
    for (let i = 0; i < ids.length; i++) {
      this.updateLineColor(ids[i], colors[i])
    }
  }

  /**
   * 更新指定线段的类型与子类型(同步更新颜色与内部记录)
   * @param id 线段内部 id
   * @param type 新类型
   * @param subtype 新子类型
   */
  updateLineType(id: number, type: string, subtype: string): void {
    const entry = this.finishedLines.get(id)
    if (!entry) return
    entry.type = type
    entry.subtype = subtype
    const color = TYPE_COLORS[type] ?? 0x00ff00
    entry.material.color.setHex(color)
    entry.material.needsUpdate = true
  }

  // ============================================================
  //  Lanelet 可视化
  // ============================================================

  /**
   * 添加 Lanelet 面片 + 方向箭头
   *
   * - 左右边界坐标组成闭合多边形(左边界正向 + 右边界反向)
   * - 用 THREE.Shape + ShapeGeometry 生成网格
   * - 材质:半透明 MeshBasicMaterial,DoubleSide
   * - 方向箭头位于 Lanelet 中心,方向由左边界起点指向终点
   *
   * @param id Lanelet 后端 id(同 id 会先移除旧可视化)
   * @param leftCoords 左边界扁平坐标 [x0,y0,z0, ...]
   * @param rightCoords 右边界扁平坐标 [x0,y0,z0, ...]
   * @param color 面片颜色(0xRRGGBB)
   * @param direction 方向:'forward'(左边界起点->终点) | 'backward'(反向)
   */
  addLaneletMesh(
    id: number,
    leftCoords: number[],
    rightCoords: number[],
    color: number,
    direction: 'forward' | 'backward' = 'forward',
  ): void {
    // 同 id 先移除旧的,避免重复
    this.removeLaneletMesh(id)

    const THREE = this.THREE
    if (!THREE || !this.viewer) return

    // 解析左右边界点
    const leftPts = this.parseCoords(leftCoords)
    const rightPts = this.parseCoords(rightCoords)
    if (leftPts.length < 2 || rightPts.length < 2) return

    // 计算边界平均 Z(将多边形放置在边界平均高度,近似贴合路面)
    let sumZ = 0
    let zCount = 0
    for (const p of leftPts) { sumZ += p.z; zCount++ }
    for (const p of rightPts) { sumZ += p.z; zCount++ }
    const avgZ = zCount > 0 ? sumZ / zCount : 0

    // 构造闭合多边形:左边界正向 + 右边界反向
    const allPts = [...leftPts, ...rightPts.slice().reverse()]
    if (allPts.length < 3) return

    const shape = new THREE.Shape()
    shape.moveTo(allPts[0].x, allPts[0].y)
    for (let i = 1; i < allPts.length; i++) {
      shape.lineTo(allPts[i].x, allPts[i].y)
    }
    shape.closePath()

    // 用 ShapeBufferGeometry 而非 ShapeGeometry:
    // THREE.js r124 中 ShapeGeometry 继承旧版 Geometry(有 vertices 无 attributes),
    // ShapeBufferGeometry 继承 BufferGeometry(有 attributes.position)
    const geometry = new THREE.ShapeBufferGeometry(shape)
    // ShapeBufferGeometry 生成在 XY 平面(z=0),将所有顶点 Z 抬到边界平均高度
    const positions = geometry.attributes.position
    if (positions) {
      for (let i = 0; i < positions.count; i++) {
        positions.setZ(i, avgZ)
      }
      positions.needsUpdate = true
    }
    geometry.computeVertexNormals()

    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = 900
    this.threeScene.add(mesh)

    // 方向箭头:位于 Lanelet 中心,方向由左边界起点指向终点
    const leftStart = new THREE.Vector3(leftPts[0].x, leftPts[0].y, leftPts[0].z)
    const leftEnd = new THREE.Vector3(
      leftPts[leftPts.length - 1].x,
      leftPts[leftPts.length - 1].y,
      leftPts[leftPts.length - 1].z,
    )
    let dirVec = new THREE.Vector3().subVectors(leftEnd, leftStart)
    // 投影到 XY 平面,避免箭头因 Z 分量朝上/下
    dirVec.z = 0
    if (dirVec.lengthSq() < 1e-6) {
      dirVec = new THREE.Vector3(1, 0, 0)
    }
    dirVec.normalize()
    // 保存 forward 基础方向(未取反)
    const forwardDir = dirVec.clone()
    if (direction === 'backward') {
      dirVec.negate()
    }

    // 中心点(左右边界所有点的平均)
    let cx = 0, cy = 0, cz = 0
    let cn = 0
    for (const p of leftPts) { cx += p.x; cy += p.y; cz += p.z; cn++ }
    for (const p of rightPts) { cx += p.x; cy += p.y; cz += p.z; cn++ }
    const center = new THREE.Vector3(
      cn > 0 ? cx / cn : 0,
      cn > 0 ? cy / cn : 0,
      cn > 0 ? cz / cn : avgZ,
    )

    // 方向箭头:沿路径轨迹分布多个小箭头,跟随线路弯曲方向
    const arrows: any[] = []
    const arrowColor = color
    const boundLen = this.estimateBoundLength(leftPts)

    // 沿左右边界中线采样箭头位置
    const minLen = Math.min(leftPts.length, rightPts.length)
    const step = Math.max(1, Math.floor(minLen / 5)) // 大约 5 个箭头
    for (let i = 0; i < minLen; i += step) {
      const lp = leftPts[i]
      const rp = rightPts[i]
      // 中点位置
      const midX = (lp.x + rp.x) / 2
      const midY = (lp.y + rp.y) / 2
      const midZ = (lp.z + rp.z) / 2

      // 当前采样点处的 Lanelet 宽度(左右边界距离)
      const widthVec = new THREE.Vector3(rp.x - lp.x, rp.y - lp.y, rp.z - lp.z)
      const laneWidth = widthVec.length()
      // 箭头大小不超过宽度的一半,且在 [0.5, 3] 范围内
      const arrowSize = Math.min(3, Math.max(0.5, Math.min(laneWidth / 2, boundLen / 10)))

      // 方向:沿左边界切线(当前点→下一个点)
      const nextIdx = Math.min(i + 1, leftPts.length - 1)
      const dx = leftPts[nextIdx].x - lp.x
      const dy = leftPts[nextIdx].y - lp.y
      let segDir = new THREE.Vector3(dx, dy, 0)
      if (segDir.lengthSq() < 1e-6) continue
      segDir.normalize()
      if (direction === 'backward') {
        segDir.negate()
      }

      const arrow = new THREE.ArrowHelper(
        segDir,
        new THREE.Vector3(midX, midY, midZ + 0.1),
        arrowSize,
        arrowColor,
        arrowSize * 0.4,
        arrowSize * 0.3,
      )
      arrow.renderOrder = 999
      arrow.line?.material && (arrow.line.material.depthTest = false)
      arrow.cone?.material && (arrow.cone.material.depthTest = false)
      this.threeScene.add(arrow)
      arrows.push(arrow)
    }

    // 如果没有采样到箭头(边界太短),在中心放一个
    if (arrows.length === 0) {
      // 计算平均宽度用于 fallback 箭头大小
      let avgWidth = 3
      if (leftPts.length > 0 && rightPts.length > 0) {
        const lp = leftPts[0]
        const rp = rightPts[0]
        avgWidth = Math.sqrt((rp.x - lp.x) ** 2 + (rp.y - lp.y) ** 2 + (rp.z - lp.z) ** 2)
      }
      const fallbackSize = Math.min(3, Math.max(0.5, Math.min(avgWidth / 2, boundLen / 10)))
      const arrow = new THREE.ArrowHelper(
        dirVec,
        center,
        fallbackSize,
        arrowColor,
        fallbackSize * 0.4,
        fallbackSize * 0.3,
      )
      arrow.renderOrder = 999
      arrow.line?.material && (arrow.line.material.depthTest = false)
      arrow.cone?.material && (arrow.cone.material.depthTest = false)
      this.threeScene.add(arrow)
      arrows.push(arrow)
    }

    this.laneletMeshes.set(id, {
      id,
      mesh,
      geometry,
      material,
      arrows,
      baseDir: forwardDir,
      direction,
      baseColor: color,
      baseOpacity: 0.3,
    })
  }

  /** 移除 Lanelet 可视化(释放几何体与材质) */
  removeLaneletMesh(id: number): void {
    const entry = this.laneletMeshes.get(id)
    if (!entry) return
    this.safeRemoveFromScene(entry.mesh)
    this.safeDispose(entry.geometry, 'lanelet.geometry')
    this.safeDispose(entry.material, 'lanelet.material')
    // 清理所有箭头
    for (const arrow of entry.arrows ?? []) {
      this.safeRemoveFromScene(arrow)
      this.safeDispose(arrow?.line?.geometry, 'arrow.line.geometry')
      this.safeDispose(arrow?.line?.material, 'arrow.line.material')
      this.safeDispose(arrow?.cone?.geometry, 'arrow.cone.geometry')
      this.safeDispose(arrow?.cone?.material, 'arrow.cone.material')
    }
    this.laneletMeshes.delete(id)
  }

  /**
   * 高亮 / 取消高亮 Lanelet
   * - 高亮:提高不透明度并开启深度写入,使其更醒目
   * - 取消:恢复基础不透明度
   */
  highlightLanelet(id: number, highlight: boolean): void {
    const entry = this.laneletMeshes.get(id)
    if (!entry) return
    if (highlight) {
      entry.material.opacity = Math.min(0.85, entry.baseOpacity + 0.4)
      entry.material.depthWrite = true
    } else {
      entry.material.opacity = entry.baseOpacity
      entry.material.depthWrite = false
    }
    entry.material.needsUpdate = true
  }

  /** 清除所有 Lanelet 可视化 */
  clearAllLaneletMeshes(): void {
    for (const id of Array.from(this.laneletMeshes.keys())) {
      this.removeLaneletMesh(id)
    }
  }

  /** 获取当前可视化的 Lanelet 数量 */
  getLaneletMeshCount(): number {
    return this.laneletMeshes.size
  }

  /** 判断指定 Lanelet 是否已可视化 */
  hasLaneletMesh(id: number): boolean {
    return this.laneletMeshes.has(id)
  }

  /**
   * 设置所有标注的 depthTest 模式
   * - true: 标注穿透点云显示(depthTest=false,始终可见)
   * - false: 标注正常深度渲染(被点云遮挡)
   */
  setAnnotationOnTop(onTop: boolean): void {
    this.annotationOnTop = onTop
    // onTop=true: 标注穿透点云显示(depthTest=false)
    // onTop=false: 标注正常深度渲染(depthTest=true)
    const depthTest = !onTop
    // Lanelet 面片
    for (const entry of this.laneletMeshes.values()) {
      entry.material.depthTest = depthTest
      entry.material.needsUpdate = true
      for (const arrow of entry.arrows ?? []) {
        arrow.line?.material && (arrow.line.material.depthTest = depthTest)
        arrow.cone?.material && (arrow.cone.material.depthTest = depthTest)
      }
    }
    // 已完成线段
    for (const entry of this.finishedLines.values()) {
      entry.material.depthTest = depthTest
      entry.material.needsUpdate = true
    }
    // 锚点
    for (const mesh of this.anchorMeshes) {
      mesh.material.depthTest = depthTest
      mesh.material.needsUpdate = true
    }
    // 预览线
    if (this.previewLine?.material) {
      this.previewLine.material.depthTest = depthTest
      this.previewLine.material.needsUpdate = true
    }
    // 吸附指示器
    if (this.snapIndicator?.material) {
      this.snapIndicator.material.depthTest = depthTest
      this.snapIndicator.material.needsUpdate = true
    }
  }

  /**
   * 切换 Lanelet 方向(forward ↔ backward)
   * 只更新箭头方向,不重建网格
   */
  setLaneletDirection(id: number, direction: 'forward' | 'backward'): void {
    const entry = this.laneletMeshes.get(id)
    if (!entry || !entry.arrows || !this.THREE) return

    // 从 baseDir 计算:forward 用原方向,backward 取反
    const dir = entry.baseDir.clone()
    if (direction === 'backward') {
      dir.negate()
    }
    // 更新所有箭头方向
    for (const arrow of entry.arrows) {
      arrow.setDirection(dir)
    }
    entry.direction = direction
  }

  // ============================================================
  //  红绿灯可视化(Traffic Light)
  // ============================================================

  /**
   * 添加红绿灯可视化
   *
   * - 红色圆柱体(直径 0.4m,高度 2.5m,模拟灯杆 + 灯箱)
   * - 顶端发光小球(直径 0.5m,代表灯泡,颜色随 state 变化)
   * - 朝向箭头(从圆柱顶端水平指出,表示灯面朝向)
   *
   * @param id 红绿灯后端 id(同 id 会先移除旧可视化)
   * @param position 红绿灯底部世界坐标 [x, y, z]
   * @param orientation 朝向(欧拉角,弧度)[rx, ry, rz];rz 用于水平朝向
   * @param state 灯泡状态:red / yellow / green / unknown
   */
  addTrafficLightMesh(
    id: number,
    position: [number, number, number],
    orientation: [number, number, number] = [0, 0, 0],
    state: string = 'red',
  ): void {
    // 同 id 先移除旧的
    this.removeTrafficLightMesh(id)

    const THREE = this.THREE
    if (!THREE || !this.viewer) return

    const [x, y, z] = position
    const POLE_HEIGHT = 2.5
    const POLE_RADIUS = 0.15
    const BULB_RADIUS = 0.3
    const ARROW_LENGTH = 1.2

    // 圆柱体(灯杆 + 灯箱):沿 Y 轴竖立,底部对齐 position
    const geometry = new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, POLE_HEIGHT, 16)
    const material = new THREE.MeshBasicMaterial({
      color: 0xff2222,
      transparent: true,
      opacity: 0.85,
      depthWrite: true,
    })
    const mesh = new THREE.Mesh(geometry, material)
    // CylinderGeometry 默认中心在原点,平移使底部位于 position
    mesh.position.set(x, y, z + POLE_HEIGHT / 2)
    mesh.renderOrder = 950
    this.threeScene.add(mesh)

    // 顶端灯泡小球
    const bulbColor = TRAFFIC_LIGHT_STATE_COLORS[state] ?? 0xff0000
    const bulbGeometry = new THREE.SphereGeometry(BULB_RADIUS, 16, 16)
    const bulbMaterial = new THREE.MeshBasicMaterial({
      color: bulbColor,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
    const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial)
    bulb.position.set(x, y, z + POLE_HEIGHT + BULB_RADIUS * 0.5)
    bulb.renderOrder = 951
    this.threeScene.add(bulb)

    // 朝向箭头:默认沿 +X 方向,根据 orientation.rz 绕 Z 轴旋转
    // 取 orientation[2] 作为水平朝向角(弧度)
    const yaw = orientation[2] || 0
    const dirVec = new THREE.Vector3(Math.cos(yaw), Math.sin(yaw), 0)
    if (dirVec.lengthSq() < 1e-6) {
      dirVec.set(1, 0, 0)
    }
    dirVec.normalize()
    const arrowOrigin = new THREE.Vector3(x, y, z + POLE_HEIGHT + BULB_RADIUS * 0.5)
    const arrow = new THREE.ArrowHelper(
      dirVec,
      arrowOrigin,
      ARROW_LENGTH,
      0xff2222,
      ARROW_LENGTH * 0.4,
      ARROW_LENGTH * 0.3,
    )
    arrow.renderOrder = 952
    arrow.line?.material && (arrow.line.material.depthTest = false)
    arrow.cone?.material && (arrow.cone.material.depthTest = false)
    this.threeScene.add(arrow)

    this.trafficLightMeshes.set(id, {
      id,
      mesh,
      geometry,
      material,
      arrow,
      bulb,
      bulbMaterial,
      baseColor: 0xff2222,
    })
  }

  /** 更新红绿灯灯泡颜色(根据 state) */
  setTrafficLightState(id: number, state: string): void {
    const entry = this.trafficLightMeshes.get(id)
    if (!entry || !entry.bulbMaterial) return
    const color = TRAFFIC_LIGHT_STATE_COLORS[state] ?? 0xcccccc
    entry.bulbMaterial.color.setHex(color)
    entry.bulbMaterial.needsUpdate = true
  }

  /** 移除红绿灯可视化(释放几何体与材质) */
  removeTrafficLightMesh(id: number): void {
    const entry = this.trafficLightMeshes.get(id)
    if (!entry) return
    this.safeRemoveFromScene(entry.mesh)
    this.safeRemoveFromScene(entry.bulb)
    this.safeRemoveFromScene(entry.arrow)
    this.safeDispose(entry.geometry, 'trafficLight.geometry')
    this.safeDispose(entry.material, 'trafficLight.material')
    this.safeDispose(entry.bulb?.geometry, 'trafficLight.bulb.geometry')
    this.safeDispose(entry.bulbMaterial, 'trafficLight.bulbMaterial')
    this.safeDispose(entry.arrow?.line?.geometry, 'trafficLight.arrow.line.geometry')
    this.safeDispose(entry.arrow?.line?.material, 'trafficLight.arrow.line.material')
    this.safeDispose(entry.arrow?.cone?.geometry, 'trafficLight.arrow.cone.geometry')
    this.safeDispose(entry.arrow?.cone?.material, 'trafficLight.arrow.cone.material')
    this.trafficLightMeshes.delete(id)
  }

  /** 高亮 / 取消高亮红绿灯 */
  highlightTrafficLight(id: number, highlight: boolean): void {
    const entry = this.trafficLightMeshes.get(id)
    if (!entry) return
    if (highlight) {
      entry.material.opacity = 1.0
      entry.material.color.setHex(0xffff00)
      if (entry.bulbMaterial) {
        entry.bulbMaterial.opacity = 1.0
      }
    } else {
      entry.material.opacity = 0.85
      entry.material.color.setHex(entry.baseColor)
      if (entry.bulbMaterial) {
        entry.bulbMaterial.opacity = 0.95
      }
    }
    entry.material.needsUpdate = true
    if (entry.bulbMaterial) entry.bulbMaterial.needsUpdate = true
  }

  /** 清除所有红绿灯可视化 */
  clearAllTrafficLightMeshes(): void {
    for (const id of Array.from(this.trafficLightMeshes.keys())) {
      this.removeTrafficLightMesh(id)
    }
  }

  /** 获取当前可视化的红绿灯数量 */
  getTrafficLightMeshCount(): number {
    return this.trafficLightMeshes.size
  }

  /** 判断指定红绿灯是否已可视化 */
  hasTrafficLightMesh(id: number): boolean {
    return this.trafficLightMeshes.has(id)
  }

  // ============================================================
  //  停止线可视化(Stop Line)
  // ============================================================

  /**
   * 添加停止线可视化(粗白色线段)
   *
   * @param id 停止线后端 id(同 id 会先移除旧可视化)
   * @param coords 构成停止线的扁平坐标 [x0,y0,z0, x1,y1,z1, ...]
   * @param color 线段颜色(默认白色 0xffffff)
   */
  addStopLineMesh(
    id: number,
    coords: number[],
    color: number = 0xffffff,
  ): void {
    // 同 id 先移除旧的
    this.removeStopLineMesh(id)

    const THREE = this.THREE
    if (!THREE || !this.viewer) return

    const pts = this.parseCoords(coords)
    if (pts.length < 2) return

    const vec3Pts = pts.map(p => new THREE.Vector3(p.x, p.y, p.z))
    const geometry = new THREE.BufferGeometry().setFromPoints(vec3Pts)
    const material = new THREE.LineBasicMaterial({
      color,
      linewidth: 5, // 注意:WebGL linewidth 在多数平台被限制为 1,这里仍设值以表达意图
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    })
    const line = new THREE.Line(geometry, material)
    line.renderOrder = 960
    line.frustumCulled = false
    this.threeScene.add(line)

    // 为弥补 linewidth 在 WebGL 中的限制,额外添加一串沿坐标的小球以增强可见性
    // (可选的"粗线"模拟方案)
    const dotGeometry = new THREE.BufferGeometry()
    const dotPositions = new Float32Array(vec3Pts.length * 3)
    vec3Pts.forEach((p, i) => {
      dotPositions[i * 3] = p.x
      dotPositions[i * 3 + 1] = p.y
      dotPositions[i * 3 + 2] = p.z
    })
    dotGeometry.setAttribute('position', new THREE.BufferAttribute(dotPositions, 3))
    const dotMaterial = new THREE.PointsMaterial({
      color,
      size: 0.4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    })
    const dots = new THREE.Points(dotGeometry, dotMaterial)
    dots.renderOrder = 961
    dots.frustumCulled = false
    this.threeScene.add(dots)

    this.stopLineMeshes.set(id, {
      id,
      line,
      geometry,
      material,
    })

    // 将附加的点云对象临时挂到 entry 上以便释放
    ;(this.stopLineMeshes.get(id) as any).__dots = dots
    ;(this.stopLineMeshes.get(id) as any).__dotGeometry = dotGeometry
    ;(this.stopLineMeshes.get(id) as any).__dotMaterial = dotMaterial
  }

  /** 移除停止线可视化(释放几何体与材质) */
  removeStopLineMesh(id: number): void {
    const entry = this.stopLineMeshes.get(id)
    if (!entry) return
    this.safeRemoveFromScene(entry.line)
    this.safeRemoveFromScene((entry as any).__dots)
    this.safeDispose(entry.geometry, 'stopLine.geometry')
    this.safeDispose(entry.material, 'stopLine.material')
    this.safeDispose((entry as any).__dotGeometry, 'stopLine.dotGeometry')
    this.safeDispose((entry as any).__dotMaterial, 'stopLine.dotMaterial')
    this.stopLineMeshes.delete(id)
  }

  /** 清除所有停止线可视化 */
  clearAllStopLineMeshes(): void {
    for (const id of Array.from(this.stopLineMeshes.keys())) {
      this.removeStopLineMesh(id)
    }
  }

  /** 获取当前可视化的停止线数量 */
  getStopLineMeshCount(): number {
    return this.stopLineMeshes.size
  }

  // ============================================================
  //  单点拾取模式(用于红绿灯放置)
  // ============================================================

  /**
   * 启动单点拾取模式
   *
   * - 监听下一次左键点击(非拖拽),拾取点云坐标
   * - 命中后通过 onPointPicked 回调返回坐标,并自动退出拾取模式
   * - 期间屏蔽 Potree 左键旋转,保留右键平移 / 滚轮缩放
   * - 若当前处于绘制模式,会先停止绘制
   */
  startPicking(): void {
    if (this.isPicking) return
    // 若正在绘制,先退出绘制
    if (this.isDrawing) {
      this.stopDrawing()
    }
    this.isPicking = true

    this.disablePotreeNavigation()

    const dom = this.getDomElement()
    if (dom) {
      dom.addEventListener('mousedown', this.boundMouseDown, true)
      dom.addEventListener('mouseup', this.boundMouseUp, true)
    }
    window.addEventListener('keydown', this.boundKeyDown, true)
  }

  /** 退出单点拾取模式 */
  stopPicking(): void {
    if (!this.isPicking) return
    this.isPicking = false

    const dom = this.getDomElement()
    if (dom) {
      dom.removeEventListener('mousedown', this.boundMouseDown, true)
      dom.removeEventListener('mouseup', this.boundMouseUp, true)
    }
    window.removeEventListener('keydown', this.boundKeyDown, true)

    this.enablePotreeNavigation()
  }

  /** 当前是否处于绘制模式 */
  getIsDrawing(): boolean {
    return this.isDrawing
  }

  /** 当前是否处于拾取模式 */
  isPickMode(): boolean {
    return this.isPicking
  }

  // ============================================================
  //  吸附(Snapping)公开 API
  // ============================================================

  /** 开启/关闭吸附 */
  setSnapEnabled(enabled: boolean): void {
    this.snapEnabled = enabled
    if (!enabled) {
      this.snapTarget = null
      this.hideSnapIndicator()
    }
  }

  /** 获取吸附开关状态 */
  isSnapEnabled(): boolean {
    return this.snapEnabled
  }

  /** 设置吸附阈值(米) */
  setSnapThreshold(threshold: number): void {
    this.snapThreshold = Math.max(0.1, threshold)
  }

  /** 获取当前吸附阈值 */
  getSnapThreshold(): number {
    return this.snapThreshold
  }

  /**
   * 公开的点云拾取入口:直接从 MouseEvent 拾取点云坐标
   * 供需要"在任意时刻获取点云坐标"的场景使用(不依赖拾取模式)。
   * @returns 命中坐标;未命中返回 null
   */
  pickPointPublic(event: MouseEvent): MousePos | null {
    const p = this.pickPoint(event)
    if (!p) return null
    return { x: p.x, y: p.y, z: p.z }
  }

  /**
   * 检测新 Lanelet 是否与已有 Lanelet 区域重叠(XY 平面)
   * 使用射线投射:对新多边形的每个顶点,检查是否落在已有 Lanelet 的多边形内
   *
   * @param leftCoords 新 Lanelet 左边界坐标
   * @param rightCoords 新 Lanelet 右边界坐标
   * @param excludeId 排除不检测的 Lanelet id(自身更新时用)
   * @returns 重叠的 Lanelet id 数组,空数组表示无碰撞
   */
  checkLaneletOverlap(
    leftCoords: number[],
    rightCoords: number[],
    excludeId?: number,
  ): number[] {
    if (!this.THREE) return []
    const THREE = this.THREE

    const leftPts = this.parseCoords(leftCoords)
    const rightPts = this.parseCoords(rightCoords)
    const newPts = [...leftPts, ...rightPts.slice().reverse()]

    const overlaps: number[] = []

    for (const [id, entry] of this.laneletMeshes) {
      if (id === excludeId) continue

      // 获取已有 Lanelet 的顶点(XY 平面)
      const existingPts = this.getLaneletPolygonVertices(entry)
      if (existingPts.length < 3) continue

      // 检查新多边形的顶点是否在已有多边形内
      for (const p of newPts) {
        if (this.pointInPolygon(p.x, p.y, existingPts)) {
          overlaps.push(id)
          break
        }
      }
      // 也检查已有多边形的顶点是否在新多边形内
      if (!overlaps.includes(id)) {
        // 新多边形顶点列表
        const newPolyPts = newPts.map(p => ({ x: p.x, y: p.y }))
        for (const ep of existingPts) {
          if (this.pointInPolygon(ep.x, ep.y, newPolyPts)) {
            overlaps.push(id)
            break
          }
        }
      }
    }

    return overlaps
  }

  /** 从 LaneletMesh 条目提取多边形 XY 顶点列表 */
  private getLaneletPolygonVertices(entry: LaneletMesh): { x: number; y: number }[] {
    if (!entry.geometry?.attributes?.position) return []
    const pos = entry.geometry.attributes.position
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i < pos.count; i++) {
      pts.push({ x: pos.getX(i), y: pos.getY(i) })
    }
    return pts
  }

  /**
   * 射线法判断点是否在多边形内(XY 平面)
   */
  private pointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]): boolean {
    let inside = false
    const n = polygon.length
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y
      const xj = polygon[j].x, yj = polygon[j].y
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
      if (intersect) inside = !inside
    }
    return inside
  }

  /**
   * 检查新点是否与已绘制线段的任何点过近
   * @param x 新点 X
   * @param y 新点 Y
   * @param z 新点 Z
   * @param threshold 距离阈值(米)
   * @returns 碰撞的线段内部 id,空数组表示无碰撞
   */
  checkPointCollision(x: number, y: number, z: number, threshold = 0.5): number[] {
    const collisions: number[] = []
    for (const [id, entry] of this.finishedLines) {
      // coords 是扁平数组 [x1,y1,z1, x2,y2,z2, ...],每 3 个数一个点
      const coords = entry.coords
      for (let i = 0; i < coords.length; i += 3) {
        const dx = coords[i] - x
        const dy = coords[i + 1] - y
        const dz = coords[i + 2] - z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist < threshold) {
          collisions.push(id)
          break
        }
      }
    }
    return collisions
  }

  /** 点云加载/切换后通知(预留:可在此重置预览或做适配) */
  notifyPointcloudChanged(): void {
    // 当前拾取基于 viewer.scene.pointclouds 自动适配,无需特殊处理
    // 重置悬停坐标,避免显示失效坐标
    this.currentMousePos = null
    if (this.isDrawing) {
      this.updatePreview()
    }
  }

  /** 销毁:移除所有监听并释放全部资源 */
  dispose(): void {
    this.stopPicking()
    this.stopDrawing()
    // 确保吸附指示器已释放(stopDrawing 中已处理,此处兜底)
    this.disposeSnapIndicator()
    this.clearAllFinishedLines()
    this.clearAllLaneletMeshes()
    this.clearAllTrafficLightMeshes()
    this.clearAllStopLineMeshes()
    const dom = this.getDomElement()
    if (dom) {
      dom.removeEventListener('mousemove', this.boundMouseMove, true)
      dom.removeEventListener('contextmenu', this.boundContextMenu, true)
    }
    this.onPointAdded = undefined
    this.onLineFinished = undefined
    this.onCollision = undefined
    this.onModeChanged = undefined
    this.onMouseMove = undefined
    this.onPointPicked = undefined
  }

  // ============================================================
  //  事件处理
  // ============================================================

  private handleMouseMove(event: MouseEvent): void {
    // 节流:非绘制时只做悬停拾取,限制频率
    const now = performance.now()

    if (this.isDrawing) {
      // 绘制模式:更新预览线末端,但不阻止 Potree 相机交互
      // 用户可以用右键旋转、中键平移、滚轮缩放
      if (now - this.lastHoverTime < HOVER_THROTTLE_MS) return
      this.lastHoverTime = now
      const point = this.pickPoint(event)
      if (point) {
        // 吸附预览:如果开启吸附,尝试吸附当前鼠标位置
        // 预览时不做点云法向量估计(includePointcloud=false)以保持流畅
        let previewPoint = point
        if (this.snapEnabled) {
          previewPoint = this.snapPoint(point, false)
          if (this.snapTarget) {
            this.showSnapIndicator(this.snapTarget)
          } else {
            this.hideSnapIndicator()
          }
        }
        this.currentMousePos = previewPoint
        // 状态栏显示原始拾取坐标(非吸附后坐标)
        this.onMouseMove?.({ x: point.x, y: point.y, z: point.z })
      } else {
        this.hideSnapIndicator()
      }
      this.updatePreview()
      // 不调用 stopImmediatePropagation,让 Potree 的导航事件正常工作
    } else {
      // 非绘制模式:仅悬停拾取(节流),不阻止冒泡,Potree 正常交互
      if (now - this.lastHoverTime < HOVER_THROTTLE_MS) return
      this.lastHoverTime = now
      const point = this.pickPoint(event)
      this.onMouseMove?.(point ? { x: point.x, y: point.y, z: point.z } : null)
    }
  }

  private handleMouseDown(event: MouseEvent): void {
    // 绘制模式或拾取模式均需拦截左键 mousedown
    if (!this.isDrawing && !this.isPicking) return
    if (event.button !== 0) return // 仅拦截左键
    // 记录按下位置,用于 mouseup 判断是否为简单点击
    this.mouseDownX = event.clientX
    this.mouseDownY = event.clientY
    // 阻止 Potree InputHandler 收到左键 mousedown,防止启动旋转
    event.stopImmediatePropagation()
  }

  private handleMouseUp(event: MouseEvent): void {
    if (!this.isDrawing && !this.isPicking) return
    if (event.button !== 0) return // 仅响应左键
    // 判断是否为简单点击(鼠标移动距离小于阈值,非拖拽)
    const dx = event.clientX - this.mouseDownX
    const dy = event.clientY - this.mouseDownY
    const moveDist = Math.sqrt(dx * dx + dy * dy)
    if (moveDist > 5) return // 拖拽,忽略
    // 简单点击:拾取点云
    event.stopImmediatePropagation()
    event.preventDefault()
    const point = this.pickPoint(event)
    if (!point) {
      console.warn('[DrawingManager] 左键点击未命中点云,请确保鼠标在点云可见区域内点击')
      if (this.isPicking) {
        this.onCollision?.('未拾取到点云坐标,请重试')
      }
      return
    }

    // 拾取模式:返回坐标后自动退出
    if (this.isPicking) {
      const pos: MousePos = { x: point.x, y: point.y, z: point.z }
      this.onPointPicked?.(pos)
      this.stopPicking()
      return
    }

    // 绘制模式:放置锚点
    this.addPoint(point)
  }

  private handleDblClick(event: MouseEvent): void {
    if (!this.isDrawing) return
    event.stopImmediatePropagation()
    event.preventDefault()
    this.finishLine()
  }

  private handleContextMenu(event: MouseEvent): void {
    // 始终屏蔽 Potree canvas 上的系统右键菜单(utools / 浏览器默认菜单)
    event.stopImmediatePropagation()
    event.preventDefault()
    // 绘制模式下,右键单击同时撤销最后一个锚点
    if (this.isDrawing) {
      this.undoLastPoint()
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // Esc 在拾取模式下取消拾取
    if (this.isPicking && event.key === 'Escape') {
      event.stopImmediatePropagation()
      event.preventDefault()
      this.stopPicking()
      return
    }
    if (!this.isDrawing) return
    if (event.key === 'Escape') {
      event.stopImmediatePropagation()
      event.preventDefault()
      this.cancelDrawing()
      return
    }
    if (event.key === 'Enter') {
      // Enter 也可完成线段
      event.stopImmediatePropagation()
      event.preventDefault()
      this.finishLine()
      return
    }
    if ((event.key === 'z' || event.key === 'Z') && (event.ctrlKey || event.metaKey)) {
      // Ctrl/Cmd+Z 撤销
      event.stopImmediatePropagation()
      event.preventDefault()
      this.undoLastPoint()
      return
    }
    // 屏蔽 Potree 相机移动键(WASD / 方向键 / +-),避免绘制时相机漂移
    const navKeys = new Set([
      'w', 'a', 's', 'd', 'W', 'A', 'S', 'D',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      '+', '-', '=',
    ])
    if (navKeys.has(event.key)) {
      event.stopImmediatePropagation()
      event.preventDefault()
    }
  }

  // ============================================================
  //  吸附(Snapping)内部实现
  // ============================================================

  /**
   * 执行吸附,返回吸附后的点
   *
   * 按优先级依次尝试:
   *   1. 已有线段端点(首尾点)
   *   2. 已有线段中间点
   *   3. 点云表面(局部法向量估计 + 投影)
   *
   * 若所有策略均未命中,返回原始点并清除 snapTarget。
   *
   * @param originalPoint 拾取到的原始点
   * @param includePointcloud 是否包含点云表面吸附(预览时可关闭以提升性能)
   */
  private snapPoint(originalPoint: any, includePointcloud: boolean = true): any {
    const THREE = this.THREE
    if (!THREE) {
      this.snapTarget = null
      return originalPoint
    }

    // 策略 1:线段端点(最高优先级)
    let result = this.snapToLineEndpoints(originalPoint)
    if (result) {
      this.snapTarget = result
      return result
    }

    // 策略 2:线段中间点
    result = this.snapToLineMidpoints(originalPoint)
    if (result) {
      this.snapTarget = result
      return result
    }

    // 策略 3:点云表面(法向量估计)
    if (includePointcloud) {
      result = this.snapToPointcloudSurface(originalPoint)
      if (result) {
        this.snapTarget = result
        return result
      }
    }

    // 无吸附目标
    this.snapTarget = null
    return originalPoint
  }

  /**
   * 策略 1:检查与所有 finishedLines 首尾点的距离
   * @returns 最近的端点(在阈值内),或 null
   */
  private snapToLineEndpoints(point: any): any | null {
    const THREE = this.THREE
    let best: any = null
    let bestDist = this.snapThreshold

    for (const entry of this.finishedLines.values()) {
      const coords = entry.coords
      if (coords.length < 3) continue
      // 首点(idx=0)和尾点(idx=len-3)
      const indices = [0, coords.length - 3]
      for (const idx of indices) {
        if (idx < 0) continue
        const dx = coords[idx] - point.x
        const dy = coords[idx + 1] - point.y
        const dz = coords[idx + 2] - point.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist < bestDist) {
          bestDist = dist
          best = new THREE.Vector3(coords[idx], coords[idx + 1], coords[idx + 2])
        }
      }
    }
    return best
  }

  /**
   * 策略 2:检查与所有 finishedLines 中间点的距离
   * (跳过首尾点,仅检查中间顶点)
   * @returns 最近的中间点(在阈值内),或 null
   */
  private snapToLineMidpoints(point: any): any | null {
    const THREE = this.THREE
    let best: any = null
    let bestDist = this.snapThreshold

    for (const entry of this.finishedLines.values()) {
      const coords = entry.coords
      // 跳过首点(idx=0)和尾点(idx=len-3),仅检查中间点
      for (let i = 3; i < coords.length - 3; i += 3) {
        const dx = coords[i] - point.x
        const dy = coords[i + 1] - point.y
        const dz = coords[i + 2] - point.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist < bestDist) {
          bestDist = dist
          best = new THREE.Vector3(coords[i], coords[i + 1], coords[i + 2])
        }
      }
    }
    return best
  }

  /**
   * 策略 3:点云表面吸附
   *
   * 在拾取点附近搜索 K 个最近点云点,用 PCA 计算局部法向量,
   * 将拾取点投影到局部平面。
   *
   * 性能优化:
   *   - 采样点云(每隔 step 个点取一个),限制最大检查点数
   *   - 仅在半径 snapThreshold 内搜索邻居
   *
   * @returns 投影后的点,或 null(邻居不足/投影距离过大)
   */
  private snapToPointcloudSurface(point: any): any | null {
    const THREE = this.THREE
    if (!THREE || !this.viewer) return null

    const pointclouds = this.viewer.scene?.pointclouds
    if (!pointclouds || pointclouds.length === 0) return null

    const searchRadius = this.snapThreshold
    const maxNeighbors = 30
    // 限制采样点数,避免遍历数百万点导致卡顿
    const maxSamplePoints = 50000

    const neighbors: { x: number; y: number; z: number; dist: number }[] = []

    for (const pc of pointclouds) {
      if (!pc) continue
      try {
        const geometry = pc.geometry
        if (!geometry?.attributes?.position) continue
        const positions = geometry.attributes.position
        const count = positions.count
        // 采样步长:确保最多检查 maxSamplePoints 个点
        const step = Math.max(1, Math.floor(count / maxSamplePoints))

        // 获取世界变换矩阵
        const m = pc.matrixWorld
        const e = m?.elements
        if (!e) continue

        // 直接访问 typed array 提升性能
        const arr = positions.array
        const itemSize = positions.itemSize || 3

        for (let i = 0; i < count; i += step) {
          const base = i * itemSize
          const x = arr[base]
          const y = arr[base + 1]
          const z = arr[base + 2]
          // 变换到世界坐标
          const wx = e[0] * x + e[4] * y + e[8] * z + e[12]
          const wy = e[1] * x + e[5] * y + e[9] * z + e[13]
          const wz = e[2] * x + e[6] * y + e[10] * z + e[14]

          const dx = wx - point.x
          const dy = wy - point.y
          const dz = wz - point.z
          const distSq = dx * dx + dy * dy + dz * dz
          if (distSq < searchRadius * searchRadius) {
            neighbors.push({ x: wx, y: wy, z: wz, dist: Math.sqrt(distSq) })
          }
        }
      } catch {
        // 单个点云访问异常,静默跳过
      }
    }

    // 邻居不足,无法拟合平面
    if (neighbors.length < 3) return null

    // 取 K 个最近邻居
    neighbors.sort((a, b) => a.dist - b.dist)
    const k = Math.min(maxNeighbors, neighbors.length)
    const used = neighbors.slice(0, k)

    // PCA:计算质心和协方差矩阵
    let cx = 0, cy = 0, cz = 0
    for (const p of used) {
      cx += p.x; cy += p.y; cz += p.z
    }
    cx /= k; cy /= k; cz /= k

    let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0
    for (const p of used) {
      const dx = p.x - cx
      const dy = p.y - cy
      const dz = p.z - cz
      xx += dx * dx; xy += dx * dy; xz += dx * dz
      yy += dy * dy; yz += dy * dz; zz += dz * dz
    }
    xx /= k; xy /= k; xz /= k; yy /= k; yz /= k; zz /= k

    // 计算最小特征值对应的特征向量(即局部法向量)
    const normal = this.computeSmallestEigenvector(xx, xy, xz, yy, yz, zz)
    if (!normal) return null

    const nx = normal[0]
    const ny = normal[1]
    const nz = normal[2]

    // 将原始点投影到局部平面(过质心,法向量为 normal)
    const d = (point.x - cx) * nx + (point.y - cy) * ny + (point.z - cz) * nz
    // 投影距离过大则放弃(避免将点拉到不合理的表面)
    if (Math.abs(d) > searchRadius) return null

    return new THREE.Vector3(
      point.x - d * nx,
      point.y - d * ny,
      point.z - d * nz,
    )
  }

  /**
   * 计算 3x3 对称矩阵最小特征值对应的特征向量
   *
   * 使用幂迭代法找到最大特征向量,然后通过压缩(deflation)找到次大,
   * 两者的叉积即为最小特征向量方向(即局部平面的法向量)。
   *
   * 矩阵形式:
   *   | xx xy xz |
   *   | xy yy yz |
   *   | xz yz zz |
   */
  private computeSmallestEigenvector(
    xx: number, xy: number, xz: number,
    yy: number, yz: number, zz: number,
  ): [number, number, number] | null {
    const matmul = (v: [number, number, number]): [number, number, number] => [
      xx * v[0] + xy * v[1] + xz * v[2],
      xy * v[0] + yy * v[1] + yz * v[2],
      xz * v[0] + yz * v[1] + zz * v[2],
    ]

    // ---- 幂迭代求最大特征向量 v1 ----
    let v1: [number, number, number] = [1, 0, 0]
    for (let iter = 0; iter < 50; iter++) {
      const r = matmul(v1)
      const len = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2])
      if (len < 1e-12) {
        // 退化情况:换一个初始向量
        v1 = [0, 1, 0]
        const r2 = matmul(v1)
        const len2 = Math.sqrt(r2[0] * r2[0] + r2[1] * r2[1] + r2[2] * r2[2])
        if (len2 < 1e-12) return null
        v1 = [r2[0] / len2, r2[1] / len2, r2[2] / len2]
        continue
      }
      const newV1: [number, number, number] = [r[0] / len, r[1] / len, r[2] / len]
      const diff = Math.abs(newV1[0] - v1[0]) + Math.abs(newV1[1] - v1[1]) + Math.abs(newV1[2] - v1[2])
      v1 = newV1
      if (diff < 1e-8) break
    }

    // 特征值 lambda1 = v1^T M v1
    const mv1 = matmul(v1)
    const lambda1 = v1[0] * mv1[0] + v1[1] * mv1[1] + v1[2] * mv1[2]

    // ---- 压缩(deflation):M' = M - lambda1 * v1 * v1^T ----
    const dxx = xx - lambda1 * v1[0] * v1[0]
    const dxy = xy - lambda1 * v1[0] * v1[1]
    const dxz = xz - lambda1 * v1[0] * v1[2]
    const dyy = yy - lambda1 * v1[1] * v1[1]
    const dyz = yz - lambda1 * v1[1] * v1[2]
    const dzz = zz - lambda1 * v1[2] * v1[2]

    const matmulDeflated = (v: [number, number, number]): [number, number, number] => [
      dxx * v[0] + dxy * v[1] + dxz * v[2],
      dxy * v[0] + dyy * v[1] + dyz * v[2],
      dxz * v[0] + dyz * v[1] + dzz * v[2],
    ]

    // ---- 幂迭代求次大特征向量 v2(在压缩后的矩阵上) ----
    // 初始向量需与 v1 正交
    let v2: [number, number, number] = [0, 1, 0]
    let dot = v2[0] * v1[0] + v2[1] * v1[1] + v2[2] * v1[2]
    v2 = [v2[0] - dot * v1[0], v2[1] - dot * v1[1], v2[2] - dot * v1[2]]
    let len2 = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1] + v2[2] * v2[2])
    if (len2 < 1e-10) {
      v2 = [0, 0, 1]
      dot = v2[0] * v1[0] + v2[1] * v1[1] + v2[2] * v1[2]
      v2 = [v2[0] - dot * v1[0], v2[1] - dot * v1[1], v2[2] - dot * v1[2]]
      len2 = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1] + v2[2] * v2[2])
      if (len2 < 1e-10) return null
    }
    v2 = [v2[0] / len2, v2[1] / len2, v2[2] / len2]

    for (let iter = 0; iter < 50; iter++) {
      const r = matmulDeflated(v2)
      // 重新正交化 against v1
      const d = r[0] * v1[0] + r[1] * v1[1] + r[2] * v1[2]
      const rOrtho: [number, number, number] = [
        r[0] - d * v1[0], r[1] - d * v1[1], r[2] - d * v1[2],
      ]
      const len = Math.sqrt(rOrtho[0] * rOrtho[0] + rOrtho[1] * rOrtho[1] + rOrtho[2] * rOrtho[2])
      if (len < 1e-12) break
      const newV2: [number, number, number] = [rOrtho[0] / len, rOrtho[1] / len, rOrtho[2] / len]
      const diff = Math.abs(newV2[0] - v2[0]) + Math.abs(newV2[1] - v2[1]) + Math.abs(newV2[2] - v2[2])
      v2 = newV2
      if (diff < 1e-8) break
    }

    // ---- 最小特征向量 = v1 × v2 ----
    const normal: [number, number, number] = [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0],
    ]

    const nlen = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2])
    if (nlen < 1e-10) return null

    return [normal[0] / nlen, normal[1] / nlen, normal[2] / nlen]
  }

  /** 创建吸附指示器(黄色发光球体,比锚点更大) */
  private createSnapIndicator(): any {
    const THREE = this.THREE
    if (!THREE) return null
    // 比锚点(0.3m)更大,更显眼
    const radius = 0.5
    this.snapIndicatorGeometry = new THREE.SphereGeometry(radius, 20, 20)
    this.snapIndicatorMaterial = new THREE.MeshBasicMaterial({
      color: 0xffdd00, // 黄色
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    })
    const mesh = new THREE.Mesh(this.snapIndicatorGeometry, this.snapIndicatorMaterial)
    mesh.renderOrder = 1001 // 比锚点(1000)更高
    mesh.visible = false
    this.threeScene.add(mesh)
    return mesh
  }

  /** 在指定位置显示吸附指示器 */
  private showSnapIndicator(pos: any): void {
    if (!this.snapIndicator) {
      this.snapIndicator = this.createSnapIndicator()
    }
    if (this.snapIndicator) {
      this.snapIndicator.position.copy(pos)
      this.snapIndicator.visible = true
    }
  }

  /** 隐藏吸附指示器 */
  private hideSnapIndicator(): void {
    if (this.snapIndicator) {
      this.snapIndicator.visible = false
    }
  }

  /** 释放吸附指示器资源 */
  private disposeSnapIndicator(): void {
    if (this.snapIndicator) {
      this.safeRemoveFromScene(this.snapIndicator)
      this.snapIndicator = null
    }
    this.safeDispose(this.snapIndicatorGeometry, 'snapIndicatorGeometry')
    this.snapIndicatorGeometry = null
    this.safeDispose(this.snapIndicatorMaterial, 'snapIndicatorMaterial')
    this.snapIndicatorMaterial = null
    this.snapTarget = null
  }

  // ============================================================
  //  内部方法
  // ============================================================

  /** 添加一个锚点 */
  private addPoint(point: any): void {
    // 吸附:如果开启吸附,尝试吸附到最近的线段端点/中间点/点云表面
    let finalPoint = point
    if (this.snapEnabled) {
      finalPoint = this.snapPoint(point)
    }
    const snapped = this.snapEnabled && this.snapTarget !== null

    // 碰撞检测:检查新点是否与已有线段的点过近(阈值 0.001m)
    // 注意:吸附是用户主动行为,吸附命中时跳过碰撞警告,避免干扰
    if (!snapped) {
      const collisions = this.checkPointCollision(finalPoint.x, finalPoint.y, finalPoint.z, 0.001)

      // 也检查当前正在绘制的线的已有锚点
      for (let i = 0; i < this.points.length; i++) {
        const p = this.points[i]
        const dx = p.x - finalPoint.x
        const dy = p.y - finalPoint.y
        const dz = p.z - finalPoint.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist < 0.001) {
          collisions.push(-1) // -1 表示当前线
          break
        }
      }

      if (collisions.length > 0) {
        const backendIds = collisions.filter(id => id !== -1).map(id => this.lineIdMap?.get(id) ?? id)
        const msg = backendIds.length > 0
          ? `点碰撞!距离已有线段 #${backendIds.join(', #')} 过近(< 0.001m)`
          : '点碰撞!距离当前线段已有点过近(< 0.001m)'
        console.warn(`[DrawingManager] ${msg}`)
        this.onCollision?.(msg)
      }
    }

    this.points.push(finalPoint.clone())
    const mesh = new this.THREE.Mesh(this.anchorGeometry, this.anchorMaterial)
    mesh.position.copy(finalPoint)
    mesh.renderOrder = 1000
    this.threeScene.add(mesh)
    this.anchorMeshes.push(mesh)
    this.updatePreview()
    this.onPointAdded?.(this.getFlatCoords())

    // 放置锚点后隐藏吸附指示器
    this.hideSnapIndicator()
  }

  /** 更新预览线(锚点 + 当前鼠标位置) */
  private updatePreview(): void {
    if (!this.previewLine || !this.previewPositions) return
    let idx = 0
    for (const p of this.points) {
      this.previewPositions[idx++] = p.x
      this.previewPositions[idx++] = p.y
      this.previewPositions[idx++] = p.z
    }
    let count = this.points.length
    if (this.currentMousePos && count > 0) {
      this.previewPositions[idx++] = this.currentMousePos.x
      this.previewPositions[idx++] = this.currentMousePos.y
      this.previewPositions[idx++] = this.currentMousePos.z
      count += 1
    }
    const geom = this.previewLine.geometry
    geom.setDrawRange(0, count)
    geom.attributes.position.needsUpdate = true
    geom.computeBoundingSphere()
    // 至少 2 个点才显示预览线
    this.previewLine.visible = count >= 2
  }

  /** 清空当前未完成线的锚点与预览(不动绘制模式与已完成线) */
  private clearCurrentDrawing(): void {
    for (const mesh of this.anchorMeshes) {
      this.threeScene.remove(mesh)
    }
    this.anchorMeshes = []
    this.points = []
    this.currentMousePos = null
    this.hideSnapIndicator()
    this.updatePreview()
  }

  /**
   * 获取相机对象(Potree 1.8.2 不同构建方式下 camera 位置不一致)
   * 优先级: viewer.scene.camera → viewer.scene.getActiveCamera() → viewer.camera
   */
  private getCamera(): any | null {
    if (!this.viewer) return null
    const scene = this.viewer.scene
    if (!scene) return null

    // 路径 1: scene.camera(Potree 标准路径)
    if (scene.camera) return scene.camera

    // 路径 2: scene.getActiveCamera()(部分 Potree 版本)
    if (typeof scene.getActiveCamera === 'function') {
      const cam = scene.getActiveCamera()
      if (cam) return cam
    }

    // 路径 3: viewer.camera(Potree 1.8 Viewer 直接持有)
    if (this.viewer.camera) return this.viewer.camera

    return null
  }

  /**
   * Potree 1.8.2 点云拾取:从鼠标位置发射射线,在所有点云中找最近命中点
   *
   * 三级回退策略:
   * 1. 优先用 Potree 自带的 inputHandler.getMousePointCloudIntersection()
   *    该方法用 Potree 内部 THREE 创建射线,避免外部 THREE 实例不匹配
   * 2. 手动射线-包围盒相交:用 THREE.Raycaster 对点云 BoundingBox 求交
   * 3. 直接调用 pc.pick()(可能因 THREE 实例不匹配而失败)
   */
  private pickPoint(event: MouseEvent): any | null {
    if (!this.viewer || !this.THREE) return null
    const pointclouds = this.viewer.scene?.pointclouds
    if (!pointclouds || pointclouds.length === 0) {
      return null
    }

    const dom = this.viewer.renderer?.domElement
    if (!dom) return null

    const rect = dom.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    // ---- 策略 1: Potree 自带拾取 API ----
    // inputHandler.getMousePointCloudIntersection 用 Potree 内部 THREE 创建射线,
    // 避免外部 window.THREE 与 Potree 内部 THREE 实例不匹配的问题
    const inputHandler = this.viewer.inputHandler
    if (inputHandler && typeof inputHandler.getMousePointCloudIntersection === 'function') {
      try {
        const mouseNDC = { x, y }
        const result = inputHandler.getMousePointCloudIntersection(mouseNDC)
        if (result && result.position) {
          const pos = result.position
          return new this.THREE.Vector3(pos.x, pos.y, pos.z)
        }
      } catch (err) {
        console.warn('[DrawingManager] getMousePointCloudIntersection 异常:', err)
      }
    }

    // ---- 策略 2: 手动射线-包围盒相交 ----
    // 对每个点云的 BoundingBox 做射线相交,返回最近交点
    const camera = this.getCamera()
    if (camera) {
      const raycaster = new this.THREE.Raycaster()
      raycaster.setFromCamera(new this.THREE.Vector2(x, y), camera)
      const ray = raycaster.ray

      let closestPoint: any = null
      let closestDist = Infinity

      for (const pc of pointclouds) {
        if (!pc) continue
        try {
          // 获取点云世界坐标包围盒
          let bbox: any = null
          if (typeof pc.getBoundingBoxWorld === 'function') {
            bbox = pc.getBoundingBoxWorld()
          } else if (pc.boundingBox) {
            bbox = pc.boundingBox.clone()
            if (pc.matrixWorld) bbox.applyMatrix4(pc.matrixWorld)
          }
          if (!bbox) continue

          const intersection = ray.intersectBox(bbox, new this.THREE.Vector3())
          if (intersection) {
            const dist = intersection.distanceTo(camera.position)
            if (dist < closestDist) {
              closestDist = dist
              closestPoint = intersection
            }
          }
        } catch {
          // 忽略单个点云的包围盒计算异常
        }
      }

      if (closestPoint) {
        return closestPoint
      }
    }

    // ---- 策略 3: 直接调用 pc.pick()(最后手段) ----
    if (camera) {
      const raycaster = new this.THREE.Raycaster()
      raycaster.setFromCamera(new this.THREE.Vector2(x, y), camera)
      const ray = new this.THREE.Ray(
        raycaster.ray.origin.clone(),
        raycaster.ray.direction.clone(),
      )

      for (const pc of pointclouds) {
        if (!pc || typeof pc.pick !== 'function') continue
        try {
          const result = pc.pick(this.viewer.renderer, camera, ray)
          if (result && result.position) {
            return result.position.clone()
          }
        } catch {
          // pc.pick 可能因 THREE 实例不匹配而失败,静默忽略
        }
      }
    }

    return null
  }

  /** 去除连续距离极近的重复点 */
  private dedupePoints(pts: any[]): any[] {
    if (pts.length === 0) return []
    const result: any[] = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      const prev = result[result.length - 1]
      const dx = pts[i].x - prev.x
      const dy = pts[i].y - prev.y
      const dz = pts[i].z - prev.z
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > DEDUP_EPSILON) {
        result.push(pts[i])
      }
    }
    return result
  }

  /** 当前锚点扁平坐标 */
  private getFlatCoords(): number[] {
    const coords: number[] = []
    for (const p of this.points) {
      coords.push(p.x, p.y, p.z)
    }
    return coords
  }

  /** 将扁平坐标数组 [x0,y0,z0,...] 解析为 {x,y,z} 数组 */
  private parseCoords(coords: number[]): { x: number; y: number; z: number }[] {
    const pts: { x: number; y: number; z: number }[] = []
    for (let i = 0; i + 2 < coords.length; i += 3) {
      pts.push({ x: coords[i], y: coords[i + 1], z: coords[i + 2] })
    }
    return pts
  }

  /** 估算折线总长度(用于自适应箭头大小) */
  private estimateBoundLength(pts: { x: number; y: number; z: number }[]): number {
    let total = 0
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x
      const dy = pts[i].y - pts[i - 1].y
      const dz = pts[i].z - pts[i - 1].z
      total += Math.sqrt(dx * dx + dy * dy + dz * dz)
    }
    return total
  }

  /** 禁用 Potree 默认相机交互(仅左键,保留右键旋转和中键/滚轮缩放) */
  private disablePotreeNavigation(): void {
    // 不完全禁用 inputHandler,只拦截左键 click 用于画点
    // 右键拖拽旋转、中键拖拽平移、滚轮缩放保持可用
    // 这样用户在绘制过程中仍可移动视角
    try {
      const ih = this.viewer.inputHandler
      if (ih) {
        // 记录原始状态
        this.prevInputEnabled = ih.enabled
        // Potree 1.8 的 inputHandler 没有单独的左键禁用,
        // 我们在 click 事件捕获阶段拦截左键即可(已在 handleClick 中处理)
        // 这里不禁用 inputHandler,保持导航可用
      }
    } catch {
      // 忽略
    }
  }

  /** 恢复 Potree 默认相机交互 */
  private enablePotreeNavigation(): void {
    try {
      const ih = this.viewer.inputHandler
      if (ih) {
        ih.enabled = this.prevInputEnabled !== undefined ? this.prevInputEnabled : true
      }
    } catch {
      // 忽略
    }
    this.prevInputEnabled = undefined
  }

  /** 获取 Potree 渲染 canvas */
  private getDomElement(): HTMLElement | null {
    return this.viewer?.renderer?.domElement ?? null
  }

  /**
   * 安全释放 Three.js 资源(geometry / material)
   * 用 try-catch 包裹 dispose,防止异常中断退出流程
   * (历史遗留:曾因双 THREE 实例导致 dispose 事件 handler 崩溃,现已统一为单实例)
   */
  private safeDispose(obj: any, label: string): void {
    if (!obj) return
    try {
      if (typeof obj.dispose === 'function') {
        obj.dispose()
      }
    } catch (err) {
      console.warn(`[DrawingManager] safeDispose(${label}) 异常:`, err)
    }
  }

  /** 安全从场景移除对象 */
  private safeRemoveFromScene(obj: any): void {
    if (!obj) return
    try {
      this.threeScene.remove(obj)
    } catch {
      // 忽略
    }
  }

  /**
   * 获取用于挂载自定义 Three.js 对象的场景。
   * Potree 1.8.2 中自定义对象应添加到 viewer.scene.scene;
   * 兼容 viewer.scene 本身即为 THREE.Scene 的情况。
   */
  private get threeScene(): any {
    const scene = this.viewer?.scene
    return (scene && scene.scene) ? scene.scene : scene
  }
}
