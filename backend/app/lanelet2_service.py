"""Lanelet2 核心服务

封装 lanelet2 Python 库,提供 Point/LineString/Lanelet 的创建与 OSM 导入导出。
注意: lanelet2 的 API 在不同版本间略有差异,本代码基于 1.2.x。
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import lanelet2
    from lanelet2.core import Lanelet, LineString3d, Point3d, getId, LaneletMap
    from lanelet2.io import Origin, write, load
    from lanelet2.projection import UtmProjector
    LANELET2_AVAILABLE = True
except ImportError:
    # 首次部署时 lanelet2 可能未装好,允许以降级模式启动
    LANELET2_AVAILABLE = False

from .config import settings


class Lanelet2Service:
    """Lanelet2 地图管理服务(每个项目一个实例)"""

    def __init__(self, origin_lat: float | None = None, origin_lon: float | None = None):
        self.origin_lat = origin_lat or settings.origin_lat
        self.origin_lon = origin_lon or settings.origin_lon
        self.origin = Origin(self.origin_lat, self.origin_lon)
        # 局部坐标 -> WGS84 投影器
        self.projector = UtmProjector(self.origin) if LANELET2_AVAILABLE else None
        self.map = LaneletMap() if LANELET2_AVAILABLE else None

    # ---------- 基础元素创建 ----------

    def add_point(self, x: float, y: float, z: float, attributes: dict[str, str] | None = None) -> int:
        """创建一个 3D 点"""
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")
        p = Point3d(getId(), x, y, z, attributes or {})
        self.map.add(p)
        return p.id

    def add_linestring(self, coords_xyz: list[float], attrs: dict[str, str] | None = None) -> int:
        """创建 LineString
        coords_xyz: 扁平数组 [x0,y0,z0, x1,y1,z1, ...]
        attrs: type/subtype 等属性
        """
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")
        if len(coords_xyz) % 3 != 0 or len(coords_xyz) < 6:
            raise ValueError("coords_xyz 必须是 3 的倍数且至少 2 个点")

        points = []
        for i in range(0, len(coords_xyz), 3):
            x, y, z = coords_xyz[i:i + 3]
            points.append(Point3d(getId(), x, y, z, {}))

        final_attrs = {"type": "line_thin", "subtype": "dashed"}
        if attrs:
            final_attrs.update(attrs)
        ls = LineString3d(getId(), points, final_attrs)
        self.map.add(ls)
        return ls.id

    def add_lanelet(self, left_ls_id: int, right_ls_id: int, attrs: dict[str, str] | None = None) -> int:
        """由左右边界 LineString 组装 Lanelet"""
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")
        left = self.map.lineStringLayer[left_ls_id]
        right = self.map.lineStringLayer[right_ls_id]
        final_attrs = {"subtype": "road"}
        if attrs:
            final_attrs.update(attrs)
        ll = Lanelet(getId(), left, right, final_attrs)
        self.map.add(ll)
        return ll.id

    # ---------- 导入/导出 ----------

    def export_osm(self, out_path: str | Path) -> str:
        """导出为 Lanelet2 OSM 文件"""
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")
        out_path = str(out_path)
        write(out_path, self.map, self.projector, self.origin)
        return out_path

    def import_osm(self, in_path: str | Path) -> int:
        """导入已有 Lanelet2 OSM,返回 lanelet 数量"""
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")
        self.map, _ = load(str(in_path), self.projector)
        return len(list(self.map.laneletLayer))

    # ---------- 查询 ----------

    def list_linestrings(self) -> list[dict[str, Any]]:
        """列出所有 LineString(给前端回显)"""
        if not LANELET2_AVAILABLE:
            return []
        result = []
        for ls in self.map.lineStringLayer:
            coords = []
            for p in ls:
                coords.extend([p.x, p.y, p.z])
            result.append({
                "id": ls.id,
                "attributes": dict(ls.attributes),
                "coords": coords,
            })
        return result

    def list_lanelets(self) -> list[dict[str, Any]]:
        """列出所有 Lanelet"""
        if not LANELET2_AVAILABLE:
            return []
        result = []
        for ll in self.map.laneletLayer:
            result.append({
                "id": ll.id,
                "left_id": ll.leftBound.id,
                "right_id": ll.rightBound.id,
                "attributes": dict(ll.attributes),
            })
        return result

    def is_available(self) -> bool:
        return LANELET2_AVAILABLE
