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

  /** 共享的锚点几何体 / 材质(绘制期间复用,退出时统一释放) */
  private anchorGeometry: any = null
  private anchorMaterial: any = null

  /** 已完成线段:id -> 记录 */
  private finishedLines: Map<number, FinishedLine> = new Map()
  /** 下一条线段的内部 id */
  private nextLineId = 1

  /** 上次悬停拾取时间戳(节流) */
  private lastHoverTime = 0

  /** 保存进入绘制模式前 Potree inputHandler 的 enabled 状态,退出时恢复 */
  private prevInputEnabled: boolean | undefined = undefined

  /** 绑定后的事件处理函数引用(便于移除监听) */
  private boundMouseMove: (e: MouseEvent) => void
  private boundClick: (e: MouseEvent) => void
  private boundDblClick: (e: MouseEvent) => void
  private boundContextMenu: (e: MouseEvent) => void
  private boundKeyDown: (e: KeyboardEvent) => void

  // ---------------- 回调(单一订阅者) ----------------
  /** 锚点添加时触发,参数为当前所有锚点的扁平坐标 [x0,y0,z0,...] */
  onPointAdded?: (points: number[]) => void
  /** 线段完成时触发,携带内部 id 供宿主做后端持久化映射 */
  onLineFinished?: (coords: number[], type: string, subtype: string, id: number) => void
  /** 绘制模式切换时触发 */
  onModeChanged?: (isDrawing: boolean) => void
  /** 鼠标悬停在点云上时触发(坐标显示);离开点云时传 null */
  onMouseMove?: (pos: MousePos | null) => void

  constructor(viewer: any, THREE: any) {
    this.viewer = viewer
    this.THREE = THREE

    this.boundMouseMove = this.handleMouseMove.bind(this)
    this.boundClick = this.handleClick.bind(this)
    this.boundDblClick = this.handleDblClick.bind(this)
    this.boundContextMenu = this.handleContextMenu.bind(this)
    this.boundKeyDown = this.handleKeyDown.bind(this)

    // 鼠标悬停拾取始终开启(供状态栏显示坐标),使用捕获阶段监听
    // 非绘制模式下不阻止冒泡,Potree 相机交互正常工作
    const dom = this.getDomElement()
    if (dom) {
      dom.addEventListener('mousemove', this.boundMouseMove, true)
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
      dom.addEventListener('click', this.boundClick, true)
      dom.addEventListener('dblclick', this.boundDblClick, true)
      dom.addEventListener('contextmenu', this.boundContextMenu, true)
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
      dom.removeEventListener('click', this.boundClick, true)
      dom.removeEventListener('dblclick', this.boundDblClick, true)
      dom.removeEventListener('contextmenu', this.boundContextMenu, true)
    }
    window.removeEventListener('keydown', this.boundKeyDown, true)

    // 清理当前未完成线
    this.clearCurrentDrawing()

    // 释放共享锚点资源
    if (this.anchorGeometry) {
      this.anchorGeometry.dispose()
      this.anchorGeometry = null
    }
    if (this.anchorMaterial) {
      this.anchorMaterial.dispose()
      this.anchorMaterial = null
    }

    // 释放预览线
    if (this.previewLine) {
      this.threeScene.remove(this.previewLine)
      this.previewLine.geometry.dispose()
      this.previewLine = null
    }
    if (this.previewLineMaterial) {
      this.previewLineMaterial.dispose()
      this.previewLineMaterial = null
    }
    this.previewPositions = null

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
    this.threeScene.remove(entry.line)
    entry.geometry.dispose()
    entry.material.dispose()
    this.finishedLines.delete(id)
  }

  /** 清空所有已完成的线段 */
  clearAllFinishedLines(): void {
    for (const id of Array.from(this.finishedLines.keys())) {
      this.removeFinishedLine(id)
    }
  }

  /** 获取已完成线段数量 */
  getFinishedCount(): number {
    return this.finishedLines.size
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
    this.stopDrawing()
    this.clearAllFinishedLines()
    const dom = this.getDomElement()
    if (dom) {
      dom.removeEventListener('mousemove', this.boundMouseMove, true)
    }
    this.onPointAdded = undefined
    this.onLineFinished = undefined
    this.onModeChanged = undefined
    this.onMouseMove = undefined
  }

  // ============================================================
  //  事件处理
  // ============================================================

  private handleMouseMove(event: MouseEvent): void {
    // 节流:非绘制时只做悬停拾取,限制频率
    const now = performance.now()

    if (this.isDrawing) {
      // 绘制模式:更新预览线末端 + 阻止 Potree 相机交互
      const point = this.pickPoint(event)
      if (point) {
        this.currentMousePos = point
        this.onMouseMove?.({ x: point.x, y: point.y, z: point.z })
      }
      this.updatePreview()
      event.stopImmediatePropagation()
      event.preventDefault()
    } else {
      // 非绘制模式:仅悬停拾取(节流),不阻止冒泡,Potree 正常交互
      if (now - this.lastHoverTime < HOVER_THROTTLE_MS) return
      this.lastHoverTime = now
      const point = this.pickPoint(event)
      this.onMouseMove?.(point ? { x: point.x, y: point.y, z: point.z } : null)
    }
  }

  private handleClick(event: MouseEvent): void {
    if (!this.isDrawing) return
    // 只响应左键
    if (event.button !== 0) return
    event.stopImmediatePropagation()
    event.preventDefault()

    const point = this.pickPoint(event)
    if (!point) return // 未命中任何点云,忽略
    this.addPoint(point)
  }

  private handleDblClick(event: MouseEvent): void {
    if (!this.isDrawing) return
    event.stopImmediatePropagation()
    event.preventDefault()
    this.finishLine()
  }

  private handleContextMenu(event: MouseEvent): void {
    if (!this.isDrawing) return
    // 右键:撤销最后一个点(并屏蔽系统右键菜单)
    event.stopImmediatePropagation()
    event.preventDefault()
    this.undoLastPoint()
  }

  private handleKeyDown(event: KeyboardEvent): void {
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
  //  内部方法
  // ============================================================

  /** 添加一个锚点 */
  private addPoint(point: any): void {
    this.points.push(point.clone())
    const mesh = new this.THREE.Mesh(this.anchorGeometry, this.anchorMaterial)
    mesh.position.copy(point)
    mesh.renderOrder = 1000
    this.threeScene.add(mesh)
    this.anchorMeshes.push(mesh)
    this.updatePreview()
    this.onPointAdded?.(this.getFlatCoords())
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
    this.updatePreview()
  }

  /**
   * Potree 1.8.2 点云拾取:从鼠标位置发射射线,在所有点云中找最近命中点
   */
  private pickPoint(event: MouseEvent): any | null {
    if (!this.viewer || !this.THREE) return null
    const pointclouds = this.viewer.scene?.pointclouds
    if (!pointclouds || pointclouds.length === 0) return null

    const dom = this.viewer.renderer?.domElement
    if (!dom) return null

    const rect = dom.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    const camera = this.viewer.scene.camera
    if (!camera) return null

    const mouse = new this.THREE.Vector3(x, y, 0.5)
    mouse.unproject(camera)
    mouse.sub(camera.position).normalize()

    const ray = {
      origin: camera.position.clone(),
      direction: mouse,
    }

    let closestPoint: any = null
    let closestDist = Infinity

    for (const pc of pointclouds) {
      if (!pc || typeof pc.pick !== 'function') continue
      try {
        const result = pc.pick(this.viewer.renderer, camera, ray)
        if (result && result.position && result.distanceToCamera < closestDist) {
          closestDist = result.distanceToCamera
          closestPoint = result.position.clone()
        }
      } catch {
        // 单个点云拾取异常时忽略,继续尝试其他点云
      }
    }

    return closestPoint
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

  /** 禁用 Potree 默认相机交互 */
  private disablePotreeNavigation(): void {
    try {
      const ih = this.viewer.inputHandler
      if (ih) {
        this.prevInputEnabled = ih.enabled
        ih.enabled = false
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
   * 获取用于挂载自定义 Three.js 对象的场景。
   * Potree 1.8.2 中自定义对象应添加到 viewer.scene.scene;
   * 兼容 viewer.scene 本身即为 THREE.Scene 的情况。
   */
  private get threeScene(): any {
    const scene = this.viewer?.scene
    return (scene && scene.scene) ? scene.scene : scene
  }
}
