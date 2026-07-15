"""FastAPI 主入口

第 2 轮目标:
1. PCD 上传后自动触发 PCD→LAS→Potree 两步转换
2. SSE 流式推送转换进度
3. 文件管理(删除/下载/重命名)
4. 统一文件列表
"""
from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import time
import uuid
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import settings
from .converters import pcd_to_las, PcdParseError
from .lanelet2_service import Lanelet2Service


app = FastAPI(
    title="Lanelet Editor API",
    description="Web 端 Lanelet2 地图编辑器后端",
    version="0.2.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局 Lanelet2 服务实例
ll_service = Lanelet2Service()

# 转换任务状态(内存,重启后清空)
# task_id -> {"status", "stage", "progress", "message", "name", "created_at"}
_tasks: dict[str, dict[str, Any]] = {}


# ---------------- 健康检查 ----------------

@app.get("/api/health")
def health() -> dict[str, Any]:
    """健康检查 + 依赖状态"""
    return {
        "status": "ok",
        "lanelet2_available": ll_service.is_available(),
        "origin": {"lat": ll_service.origin_lat, "lon": ll_service.origin_lon},
        "data_dir": str(settings.data_dir),
        "potreeconverter": Path(settings.potreeconverter_path).exists(),
    }


# ---------------- 文件列表 ----------------

@app.get("/api/files")
def list_files() -> dict[str, Any]:
    """统一文件列表: 原始文件 + 转换状态 + Potree 是否就绪"""
    raw_dir = settings.raw_dir
    pc_dir = settings.pointcloud_dir

    items = []
    # 扫描 raw 目录
    if raw_dir.exists():
        for f in raw_dir.iterdir():
            if f.is_dir() or f.name.startswith("."):
                continue
            name = f.stem  # 不含扩展名
            ext = f.suffix.lower()

            # 检查 Potree 是否已转换
            pc_path = pc_dir / name
            converted = pc_path.exists() and (pc_path / "metadata.json").exists()

            # 检查是否还有对应的 LAS(同名的 .las)
            las_path = raw_dir / f"{name}.las"
            has_las = las_path.exists()

            items.append({
                "name": name,
                "ext": ext,
                "size": f.stat().st_size,
                "created_at": int(f.stat().st_mtime),
                "has_las": has_las,
                "converted": converted,
                "status": "done" if converted else ("pending" if has_las else "raw"),
            })

    # 按 name 去重(raw 里可能同时有 pcd 和 las,只展示一次)
    seen = {}
    for it in items:
        n = it["name"]
        if n not in seen or it["ext"] in (".pcd", ".las"):
            seen[n] = it
    return {"items": list(seen.values())}


# ---------------- 上传 + 自动转换 ----------------

@app.post("/api/pointclouds/upload")
async def upload_pointcloud(
    file: UploadFile = File(...),
    auto_convert: bool = True,
) -> dict[str, Any]:
    """上传原始 PCD/LAS 文件,可选自动触发转换

    - auto_convert=true: 上传完成后后台自动跑 PCD→LAS→Potree,返回 task_id
    - auto_convert=false: 仅存盘,需手动调 /convert 接口
    """
    if not file.filename:
        raise HTTPException(400, "文件名为空")

    name = Path(file.filename).stem
    ext = Path(file.filename).suffix.lower()
    if ext not in (".pcd", ".ply", ".las", ".laz"):
        raise HTTPException(400, "仅支持 pcd/ply/las/laz 格式")

    raw_dir = settings.raw_dir
    raw_dir.mkdir(parents=True, exist_ok=True)
    dst = raw_dir / file.filename

    # 写入文件
    with dst.open("wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)

    size = dst.stat().st_size

    if not auto_convert:
        return {"saved": str(dst), "size": size, "name": name, "task_id": None}

    # 创建转换任务
    task_id = str(uuid.uuid4())[:8]
    _tasks[task_id] = {
        "status": "pending",
        "stage": "queued",
        "progress": 0,
        "message": "已入队",
        "name": name,
        "created_at": time.time(),
    }

    # 后台启动转换协程(不阻塞响应)
    asyncio.create_task(_run_convert_pipeline(task_id, name, ext))

    return {
        "saved": str(dst),
        "size": size,
        "name": name,
        "task_id": task_id,
    }


async def _run_convert_pipeline(task_id: str, name: str, src_ext: str) -> None:
    """执行 PCD→LAS→Potree 转换流水线(后台任务)"""
    task = _tasks[task_id]
    try:
        raw_dir = settings.raw_dir
        pc_dir = settings.pointcloud_dir

        # 已有 Potree 输出则跳过
        pc_out = pc_dir / name
        if pc_out.exists() and (pc_out / "metadata.json").exists():
            task.update(status="done", stage="skipped", progress=100, message="已存在转换结果,跳过")
            return

        # 步骤 1: 得到 LAS 文件
        if src_ext in (".las", ".laz"):
            las_path = raw_dir / f"{name}{src_ext}"
            task.update(status="converting", stage="potree", progress=30,
                        message=f"使用现成 {src_ext} 文件,直接转 Potree")
        else:
            # PCD → LAS
            pcd_path = raw_dir / f"{name}{src_ext}"
            las_path = raw_dir / f"{name}.las"

            task.update(status="converting", stage="pcd2las", progress=10,
                        message="正在解析 PCD → LAS")
            await asyncio.sleep(0.05)

            # 在线程池跑 CPU 密集任务
            loop = asyncio.get_event_loop()
            stats = await loop.run_in_executor(None, pcd_to_las, str(pcd_path), str(las_path))

            task.update(status="converting", stage="pcd2las_done", progress=40,
                        message=f"PCD→LAS 完成: {stats['points']} 点")

        # 步骤 2: LAS → Potree
        task.update(status="converting", stage="potree", progress=50,
                    message="正在调用 PotreeConverter")
        await asyncio.sleep(0.05)

        converter = Path(settings.potreeconverter_path)
        if not converter.exists():
            raise RuntimeError(f"PotreeConverter 未找到: {converter}")

        # 临时输出目录(避免半成品污染最终结果)
        tmp_out = pc_dir / f".{name}.tmp.{task_id}"
        if tmp_out.exists():
            shutil.rmtree(tmp_out)
        tmp_out.mkdir(parents=True, exist_ok=True)

        # 与 convert_pointcloud.sh 保持一致的参数
        # --output-format LAZ: 压缩输出,体积小
        # --attributes POSITION RGB: 只保留位置和颜色,避免无效属性导致转换异常
        cmd = [
            str(converter), str(las_path),
            "-o", str(tmp_out),
            "--output-format", "LAZ",
            "--attributes", "POSITION", "RGB",
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        # 边读输出边更新进度
        stdout_lines: list[str] = []
        if proc.stdout:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                txt = line.decode("utf-8", errors="ignore").strip()
                stdout_lines.append(txt)
                # PotreeConverter 输出进度百分比如 [67%, 1s]
                if "%" in txt:
                    task["message"] = txt
                    # 粗略映射: 50% + (potree 进度 * 50%)
                    try:
                        pct = int(txt.split("%")[0].split("[")[-1].strip().replace(" ", ""))
                        task["progress"] = min(99, 50 + pct // 2)
                    except (ValueError, IndexError):
                        pass

        await proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(
                f"PotreeConverter 退出码 {proc.returncode}\n"
                f"输出:\n" + "\n".join(stdout_lines[-20:])
            )

        # 验证转换结果: 检查 metadata.json 和 hierarchy.bin 是否生成
        meta_file = tmp_out / "metadata.json"
        hier_file = tmp_out / "hierarchy.bin"
        if not meta_file.exists() or not hier_file.exists():
            raise RuntimeError(
                f"PotreeConverter 输出不完整: metadata.json={meta_file.exists()}, "
                f"hierarchy.bin={hier_file.exists()}\n"
                f"可能原因: libtbb 版本不匹配导致并行处理失败\n"
                f"输出:\n" + "\n".join(stdout_lines[-20:])
            )

        # 原子替换
        if pc_out.exists():
            shutil.rmtree(pc_out)
        tmp_out.rename(pc_out)

        task.update(status="done", stage="finished", progress=100,
                    message=f"转换完成: {pc_out}")

    except PcdParseError as e:
        task.update(status="error", stage="pcd2las", progress=0,
                    message=f"PCD 解析失败: {e}")
    except Exception as e:
        task.update(status="error", stage="unknown", progress=0,
                    message=f"转换失败: {type(e).__name__}: {e}")


# ---------------- 转换状态 ----------------

# ---------------- 手动触发转换 ----------------

@app.post("/api/pointclouds/{name}/convert")
async def convert_pointcloud(name: str) -> dict[str, Any]:
    """手动触发已上传文件的转换(无需重新上传)

    适用于:
    - 上传时未自动转换(auto_convert=false)
    - 转换失败后重试
    - PotreeConverter 修复后重新转换
    """
    if not _is_safe_name(name):
        raise HTTPException(400, "非法名称")

    raw_dir = settings.raw_dir
    pc_dir = settings.pointcloud_dir

    # 查找原始文件(pcd/las/laz/ply)
    src_ext = None
    for ext in (".pcd", ".las", ".laz", ".ply"):
        if (raw_dir / f"{name}{ext}").exists():
            src_ext = ext
            break

    if src_ext is None:
        raise HTTPException(404, f"未找到原始文件: {name}")

    # 删除旧的转换结果(如果有)
    pc_old = pc_dir / name
    if pc_old.exists():
        shutil.rmtree(pc_old)

    # 创建转换任务
    task_id = str(uuid.uuid4())[:8]
    _tasks[task_id] = {
        "status": "pending",
        "stage": "queued",
        "progress": 0,
        "message": "手动触发转换",
        "name": name,
        "created_at": time.time(),
    }

    # 后台启动转换
    asyncio.create_task(_run_convert_pipeline(task_id, name, src_ext))

    return {"task_id": task_id, "name": name, "message": "转换已启动"}


@app.get("/api/pointclouds/{name}/status")
def get_status(name: str) -> dict[str, Any]:
    """查询点云转换状态(从最近一次转换任务中查)"""
    # 找到最近一个该 name 的任务
    candidates = [t for t in _tasks.values() if t.get("name") == name]
    if not candidates:
        # 没有任务,看文件系统
        pc = settings.pointcloud_dir / name
        if pc.exists() and (pc / "metadata.json").exists():
            return {"status": "done", "stage": "filesystem", "progress": 100,
                    "message": "已存在转换结果"}
        return {"status": "unknown", "stage": "none", "progress": 0, "message": "无任务记录"}
    task = max(candidates, key=lambda t: t.get("created_at", 0))
    return task


@app.get("/api/pointclouds/{name}/progress")
async def progress_sse(name: str) -> StreamingResponse:
    """SSE 流式推送转换进度

    客户端用 EventSource 订阅,每秒推送一次状态,直到 status 变为 done/error
    """
    async def event_stream() -> AsyncGenerator[bytes, None]:
        last_progress = -1
        while True:
            # 查询状态
            candidates = [t for t in _tasks.values() if t.get("name") == name]
            if candidates:
                task = max(candidates, key=lambda t: t.get("created_at", 0))
            else:
                pc = settings.pointcloud_dir / name
                if pc.exists() and (pc / "metadata.json").exists():
                    task = {"status": "done", "progress": 100, "message": "已就绪", "stage": "filesystem"}
                else:
                    task = {"status": "pending", "progress": 0, "message": "等待中", "stage": "queued"}

            # 只在进度变化时推送
            if task.get("progress") != last_progress or task.get("status") in ("done", "error"):
                last_progress = task.get("progress")
                data = json.dumps(task)
                yield f"data: {data}\n\n".encode()

            if task.get("status") in ("done", "error"):
                break

            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # nginx 不缓冲
        },
    )


# ---------------- 点云列表 + 加载 ----------------

@app.get("/api/pointclouds")
def list_pointclouds() -> dict[str, Any]:
    """列出所有已转换为 Potree 格式的点云"""
    pc_root = settings.pointcloud_dir
    if not pc_root.exists():
        return {"items": []}

    items = []
    for sub in pc_root.iterdir():
        if not sub.is_dir() or sub.name.startswith("."):
            continue
        meta = sub / "metadata.json"
        if not meta.exists():
            continue
        items.append({
            "name": sub.name,
            "url": f"/pointclouds/{sub.name}/metadata.json",
        })
    return {"items": items}


# ---------------- 文件管理: 删除/下载/重命名 ----------------

@app.delete("/api/pointclouds/{name}")
def delete_pointcloud(name: str) -> dict[str, Any]:
    """删除点云: 同时删除原始文件和转换结果"""
    if not _is_safe_name(name):
        raise HTTPException(400, "非法名称")

    deleted: list[str] = []
    raw_dir = settings.raw_dir
    pc_dir = settings.pointcloud_dir

    # 删 raw(所有扩展名)
    for ext in (".pcd", ".las", ".laz", ".ply"):
        p = raw_dir / f"{name}{ext}"
        if p.exists():
            p.unlink()
            deleted.append(str(p))

    # 删 Potree 输出
    pc = pc_dir / name
    if pc.exists():
        shutil.rmtree(pc)
        deleted.append(str(pc))

    if not deleted:
        raise HTTPException(404, f"未找到点云: {name}")

    # 删任务记录
    for tid in [tid for tid, t in _tasks.items() if t.get("name") == name]:
        _tasks.pop(tid, None)

    return {"deleted": deleted}


@app.get("/api/pointclouds/{name}/download")
def download_pointcloud(name: str, which: str = "pcd") -> FileResponse:
    """下载原始文件
    - which=pcd: 下载原始 PCD
    - which=las: 下载转换后的 LAS
    """
    if not _is_safe_name(name):
        raise HTTPException(400, "非法名称")

    raw_dir = settings.raw_dir
    ext_map = {"pcd": ".pcd", "las": ".las", "laz": ".laz", "ply": ".ply"}
    ext = ext_map.get(which.lower())
    if not ext:
        raise HTTPException(400, f"不支持的文件类型: {which}")

    path = raw_dir / f"{name}{ext}"
    if not path.exists():
        raise HTTPException(404, f"文件不存在: {path.name}")

    return FileResponse(
        path=str(path),
        filename=path.name,
        media_type="application/octet-stream",
    )


class RenameReq(BaseModel):
    new_name: str


@app.post("/api/pointclouds/{name}/rename")
def rename_pointcloud(name: str, req: RenameReq) -> dict[str, Any]:
    """重命名点云(同时改 raw 文件名和 Potree 目录名)"""
    if not _is_safe_name(name) or not _is_safe_name(req.new_name):
        raise HTTPException(400, "非法名称")
    if name == req.new_name:
        raise HTTPException(400, "新旧名称相同")

    raw_dir = settings.raw_dir
    pc_dir = settings.pointcloud_dir
    renamed: list[str] = []

    # 重命名 raw
    for ext in (".pcd", ".las", ".laz", ".ply"):
        src = raw_dir / f"{name}{ext}"
        if src.exists():
            dst = raw_dir / f"{req.new_name}{ext}"
            src.rename(dst)
            renamed.append(f"{src.name} -> {dst.name}")

    # 重命名 Potree 输出
    pc_src = pc_dir / name
    if pc_src.exists():
        pc_dst = pc_dir / req.new_name
        pc_src.rename(pc_dst)
        renamed.append(f"{pc_src.name} -> {pc_dst.name}")

    if not renamed:
        raise HTTPException(404, f"未找到点云: {name}")

    return {"renamed": renamed, "new_name": req.new_name}


def _is_safe_name(name: str) -> bool:
    """安全检查: 不允许路径穿越"""
    if not name or not all(c.isalnum() or c in "_-." for c in name):
        return False
    if ".." in name or "/" in name or "\\" in name:
        return False
    return True


# ---------------- Lanelet2 CRUD ----------------

class LineStringReq(BaseModel):
    coords: list[float]            # [x0,y0,z0, x1,y1,z1, ...]
    attrs: dict[str, str] | None = None


class LaneletReq(BaseModel):
    left_id: int
    right_id: int
    attrs: dict[str, str] | None = None


class LaneletUpdateReq(BaseModel):
    left_id: int | None = None
    right_id: int | None = None
    attrs: dict[str, str] | None = None


class LaneletRelationsReq(BaseModel):
    predecessor: list[int] | None = None
    successor: list[int] | None = None


class MapFileReq(BaseModel):
    path: str | None = None        # 为 None 时使用 settings.map_file 默认路径


def _is_safe_path(path: str, must_suffix: str = ".json") -> bool:
    """文件路径安全检查: 不允许路径穿越,且必须在 data_dir 内,扩展名匹配"""
    if not path:
        return False
    if ".." in path:
        return False
    p = Path(path)
    if must_suffix and p.suffix != must_suffix:
        return False
    try:
        resolved = p.resolve()
        data_dir = settings.data_dir.resolve()
        # 确保路径在 data_dir 目录内
        resolved.relative_to(data_dir)
        return True
    except (ValueError, OSError):
        return False


@app.post("/api/linestrings")
def create_linestring(req: LineStringReq) -> dict[str, Any]:
    try:
        lid = ll_service.add_linestring(req.coords, req.attrs)
        return {"id": lid}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/linestrings")
def get_linestrings() -> dict[str, Any]:
    return {"items": ll_service.list_linestrings()}


@app.get("/api/linestrings/{ls_id}")
def get_linestring(ls_id: int) -> dict[str, Any]:
    """获取单个 LineString"""
    ls = ll_service.get_linestring(ls_id)
    if ls is None:
        raise HTTPException(404, f"LineString {ls_id} 不存在")
    return ls


@app.put("/api/linestrings/{ls_id}")
def update_linestring(ls_id: int, req: LineStringReq) -> dict[str, Any]:
    """更新 LineString 的坐标和属性

    由于 lanelet2 ID 固定,更新会删除旧的并创建新的,返回新 ID。
    """
    try:
        new_id = ll_service.update_linestring(ls_id, req.coords, req.attrs)
        return {"old_id": ls_id, "id": new_id}
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/api/linestrings/{ls_id}")
def delete_linestring(ls_id: int) -> dict[str, Any]:
    """删除单个 LineString"""
    try:
        deleted = ll_service.delete_linestring(ls_id)
        if not deleted:
            raise HTTPException(404, f"LineString {ls_id} 不存在")
        return {"deleted": ls_id}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/api/linestrings")
def clear_linestrings() -> dict[str, Any]:
    """清空所有 LineString 和 Lanelet"""
    try:
        count = ll_service.clear()
        return {"cleared": count}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/linestrings/save")
def save_linestrings(req: MapFileReq) -> dict[str, Any]:
    """将当前 map 的所有 LineString / Lanelet 保存到 JSON 文件"""
    path = req.path or str(settings.map_file)
    if not _is_safe_path(path):
        raise HTTPException(400, f"非法路径(必须在 data_dir 内且为 .json 文件): {path}")
    try:
        saved = ll_service.save_to_file(path)
        return {"path": saved}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/linestrings/load")
def load_linestrings(req: MapFileReq) -> dict[str, Any]:
    """从 JSON 文件加载 LineString / Lanelet(会清空当前 map)"""
    path = req.path or str(settings.map_file)
    if not _is_safe_path(path):
        raise HTTPException(400, f"非法路径(必须在 data_dir 内且为 .json 文件): {path}")
    try:
        result = ll_service.load_from_file(path)
        return {"path": path, **result}
    except FileNotFoundError:
        raise HTTPException(404, f"文件不存在: {path}")
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"JSON 解析失败: {e}")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/lanelets")
def create_lanelet(req: LaneletReq) -> dict[str, Any]:
    try:
        lid = ll_service.add_lanelet(req.left_id, req.right_id, req.attrs)
        return {"id": lid}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/lanelets")
def get_lanelets() -> dict[str, Any]:
    return {"items": ll_service.list_lanelets()}


# 以下两个字面量路由必须放在 /api/lanelets/{ll_id} 之前注册,
# 否则 {ll_id}(int) 会先尝试匹配 "relations"/"geometry"(虽 int 转换会失败,但显式靠前更清晰)


@app.get("/api/lanelets/relations")
def get_all_lanelet_relations() -> dict[str, Any]:
    """获取所有 Lanelet 的拓扑关系(前驱/后继)"""
    return {"items": ll_service.get_all_relations()}


@app.get("/api/lanelets/geometry")
def list_lanelets_geometry() -> dict[str, Any]:
    """列出所有 Lanelet 带几何数据(左右边界坐标)"""
    return {"items": ll_service.list_lanelets_with_geometry()}


@app.get("/api/lanelets/{ll_id}")
def get_lanelet(ll_id: int) -> dict[str, Any]:
    """获取单个 Lanelet(含左右边界坐标)"""
    ll = ll_service.get_lanelet(ll_id)
    if ll is None:
        raise HTTPException(404, f"Lanelet {ll_id} 不存在")
    return ll


@app.put("/api/lanelets/{ll_id}")
def update_lanelet(ll_id: int, req: LaneletUpdateReq) -> dict[str, Any]:
    """更新 Lanelet 的左右边界或属性

    由于 lanelet2 ID 固定,更新会删除旧的并创建新的,返回新 ID。
    """
    try:
        new_id = ll_service.update_lanelet(
            ll_id, req.left_id, req.right_id, req.attrs
        )
        return {"old_id": ll_id, "id": new_id}
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/api/lanelets/{ll_id}")
def delete_lanelet(ll_id: int) -> dict[str, Any]:
    """删除单个 Lanelet"""
    deleted = ll_service.delete_lanelet(ll_id)
    if not deleted:
        raise HTTPException(404, f"Lanelet {ll_id} 不存在")
    return {"deleted": ll_id}


@app.get("/api/lanelets/{ll_id}/geometry")
def get_lanelet_geometry(ll_id: int) -> dict[str, Any]:
    """获取 Lanelet 几何数据(左右边界坐标,用于前端绘制)"""
    geom = ll_service.get_lanelet_geometry(ll_id)
    if geom is None:
        raise HTTPException(404, f"Lanelet {ll_id} 不存在")
    return geom


@app.put("/api/lanelets/{ll_id}/relations")
def set_lanelet_relations(ll_id: int, req: LaneletRelationsReq) -> dict[str, Any]:
    """设置 Lanelet 的前驱/后继拓扑关系

    body: {predecessor: [int] | null, successor: [int] | null}
    - null 表示不修改该方向
    - 空数组表示清除该方向
    """
    try:
        ll_service.set_lanelet_relations(ll_id, req.predecessor, req.successor)
        # 返回设置后的实际关系
        rel = ll_service.get_lanelet_relations(ll_id)
        return rel
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/lanelets/{ll_id}/relations")
def get_lanelet_relations(ll_id: int) -> dict[str, Any]:
    """获取 Lanelet 的前驱/后继拓扑关系"""
    rel = ll_service.get_lanelet_relations(ll_id)
    if rel is None:
        raise HTTPException(404, f"Lanelet {ll_id} 不存在")
    return rel


@app.get("/api/map/health")
def map_health() -> dict[str, Any]:
    """检查 lanelet2 和当前 map 状态"""
    linestrings = ll_service.list_linestrings()
    lanelets = ll_service.list_lanelets()
    return {
        "lanelet2_available": ll_service.is_available(),
        "linestring_count": len(linestrings),
        "lanelet_count": len(lanelets),
        "origin": {"lat": ll_service.origin_lat, "lon": ll_service.origin_lon},
        "map_file": str(settings.map_file),
    }


@app.post("/api/export")
def export_osm(path: str = "/app/data/output.osm") -> dict[str, Any]:
    try:
        out = ll_service.export_osm(path)
        return {"path": out}
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------------- 静态资源:点云目录 ----------------

app.mount(
    "/pointclouds",
    StaticFiles(directory=str(settings.pointcloud_dir)),
    name="pointclouds",
)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.host, port=settings.port)
