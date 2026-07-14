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

        cmd = [str(converter), str(las_path), "-o", str(tmp_out)]
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
