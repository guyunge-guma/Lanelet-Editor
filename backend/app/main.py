"""FastAPI 主入口

第 1 轮目标:
1. 健康检查接口
2. 点云文件列表(供前端加载)
3. Lanelet2 服务的基础 CRUD(预留给第 2 轮)
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import settings
from .lanelet2_service import Lanelet2Service


app = FastAPI(
    title="Lanelet Editor API",
    description="Web 端 Lanelet2 地图编辑器后端",
    version="0.1.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局 Lanelet2 服务实例(第 1 轮单例,后续可改为按项目隔离)
ll_service = Lanelet2Service()


# ---------------- 健康检查 ----------------

@app.get("/api/health")
def health() -> dict[str, Any]:
    """健康检查 + 依赖状态"""
    return {
        "status": "ok",
        "lanelet2_available": ll_service.is_available(),
        "origin": {"lat": ll_service.origin_lat, "lon": ll_service.origin_lon},
        "data_dir": str(settings.data_dir),
    }


# ---------------- 点云文件管理 ----------------

@app.get("/api/pointclouds")
def list_pointclouds() -> dict[str, Any]:
    """列出所有已转换的 Potree 点云目录
    每个点云对应 pointcloud_dir 下的一个子目录,必须包含 metadata.json
    """
    pc_root = settings.pointcloud_dir
    if not pc_root.exists():
        return {"items": []}

    items = []
    for sub in pc_root.iterdir():
        if not sub.is_dir():
            continue
        meta = sub / "metadata.json"
        if not meta.exists():
            continue
        items.append({
            "name": sub.name,
            "url": f"/pointclouds/{sub.name}/metadata.json",
        })
    return {"items": items}


@app.post("/api/pointclouds/upload")
async def upload_pointcloud(file: UploadFile = File(...)) -> dict[str, Any]:
    """上传原始 PCD 文件(第 1 轮只存盘,转换由 PotreeConverter 命令行完成)"""
    if not file.filename.endswith((".pcd", ".ply", ".las", ".laz")):
        raise HTTPException(400, "仅支持 pcd/ply/las/laz 格式")

    raw_dir = settings.data_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    dst = raw_dir / file.filename
    with dst.open("wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)
    return {"saved": str(dst), "size": dst.stat().st_size}


# ---------------- Lanelet2 CRUD(第 2 轮使用) ----------------

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


# ---------------- 导入/导出 ----------------

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
