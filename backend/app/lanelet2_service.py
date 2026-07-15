"""Lanelet2 核心服务

封装 lanelet2 Python 库,提供 Point/LineString/Lanelet 的创建与 OSM 导入导出。
注意: lanelet2 的 API 在不同版本间略有差异,本代码基于 1.2.x。
"""
from __future__ import annotations

import json
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

    # ---------- 单元素查询 / 修改 / 删除 ----------

    def get_linestring(self, ls_id: int) -> dict[str, Any] | None:
        """获取单个 LineString,不存在返回 None"""
        if not LANELET2_AVAILABLE:
            return None
        try:
            ls = self.map.lineStringLayer[ls_id]
        except (KeyError, IndexError, RuntimeError):
            return None
        coords = []
        for p in ls:
            coords.extend([p.x, p.y, p.z])
        return {
            "id": ls.id,
            "attributes": dict(ls.attributes),
            "coords": coords,
        }

    def update_linestring(
        self, ls_id: int, coords_xyz: list[float], attrs: dict[str, str] | None = None
    ) -> int:
        """更新已有 LineString 的坐标和属性

        由于 lanelet2 的 Point3d / LineString3d 创建后 ID 固定,无法原地修改坐标,
        需要先删除旧的 LineString,再创建新的。

        - attrs 为 None 时保留原属性
        - 如果有 Lanelet 引用了该 LineString,会自动重建引用关系

        返回新的 LineString ID
        """
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")
        if len(coords_xyz) % 3 != 0 or len(coords_xyz) < 6:
            raise ValueError("coords_xyz 必须是 3 的倍数且至少 2 个点")

        # 获取旧的 LineString
        try:
            old_ls = self.map.lineStringLayer[ls_id]
        except (KeyError, IndexError, RuntimeError) as e:
            raise ValueError(f"LineString {ls_id} 不存在") from e

        # 未提供 attrs 时保留原属性
        final_attrs = dict(old_ls.attributes) if attrs is None else attrs

        # 检查是否有 Lanelet 引用了该 LineString
        referenced_by: list[int] = []
        for ll in self.map.laneletLayer:
            if ll.leftBound.id == ls_id or ll.rightBound.id == ls_id:
                referenced_by.append(ll.id)

        # 删除旧的 LineString
        self.map.lineStringLayer.erase(old_ls)

        # 创建新的 LineString(使用 add_linestring 逻辑,但直接传入最终属性)
        points = []
        for i in range(0, len(coords_xyz), 3):
            x, y, z = coords_xyz[i:i + 3]
            points.append(Point3d(getId(), x, y, z, {}))
        new_ls = LineString3d(getId(), points, final_attrs)
        self.map.add(new_ls)
        new_id = new_ls.id

        # 如果有 Lanelet 引用了旧的 LineString,需要重建引用关系
        for ll_id in referenced_by:
            old_ll = self.map.laneletLayer[ll_id]
            left_id = new_id if old_ll.leftBound.id == ls_id else old_ll.leftBound.id
            right_id = new_id if old_ll.rightBound.id == ls_id else old_ll.rightBound.id
            ll_attrs = dict(old_ll.attributes)

            self.map.laneletLayer.erase(old_ll)

            left = self.map.lineStringLayer[left_id]
            right = self.map.lineStringLayer[right_id]
            new_ll = Lanelet(getId(), left, right, ll_attrs)
            self.map.add(new_ll)

        return new_id

    def delete_linestring(self, ls_id: int) -> bool:
        """删除 LineString

        如果有 Lanelet 引用了该 LineString,抛出 ValueError 提示先删除 Lanelet。
        """
        if not LANELET2_AVAILABLE:
            return False
        try:
            ls = self.map.lineStringLayer[ls_id]
        except (KeyError, IndexError, RuntimeError):
            return False

        # 检查是否有 Lanelet 引用了该 LineString
        for ll in self.map.laneletLayer:
            if ll.leftBound.id == ls_id or ll.rightBound.id == ls_id:
                raise ValueError(
                    f"LineString {ls_id} 被 Lanelet {ll.id} 引用,请先删除该 Lanelet"
                )

        self.map.lineStringLayer.erase(ls)
        return True

    # ---------- JSON 持久化 ----------

    def save_to_file(self, path: str | Path) -> str:
        """将当前 map 的所有 LineString / Lanelet 序列化到 JSON 文件

        JSON 格式:
        {
          "linestrings": [
            {"id": 123, "coords": [x0,y0,z0,...], "attrs": {"type": "line_thin", ...}}
          ],
          "lanelets": [
            {"id": 456, "left_id": 123, "right_id": 124, "attrs": {"subtype": "road"}}
          ]
        }
        """
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")

        # 序列化 LineString
        linestrings = []
        for ls in self.map.lineStringLayer:
            coords = []
            for p in ls:
                coords.extend([p.x, p.y, p.z])
            linestrings.append({
                "id": ls.id,
                "coords": coords,
                "attrs": dict(ls.attributes),
            })

        # 序列化 Lanelet
        lanelets = []
        for ll in self.map.laneletLayer:
            lanelets.append({
                "id": ll.id,
                "left_id": ll.leftBound.id,
                "right_id": ll.rightBound.id,
                "attrs": dict(ll.attributes),
            })

        data = {"linestrings": linestrings, "lanelets": lanelets}

        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        return str(path)

    def load_from_file(self, path: str | Path) -> dict[str, int]:
        """从 JSON 文件恢复 LineString / Lanelet

        会先清空当前 map,再从文件重建。
        由于 lanelet2 ID 生成器是全局递增的,加载后的 ID 可能与文件中的不同,
        Lanelet 的 left_id / right_id 会通过映射表自动重定向。

        返回 {"linestrings": count, "lanelets": count}
        """
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # 先清空当前 map
        self.clear()

        # 第一遍: 恢复所有 LineString,建立 old_id -> new_id 映射
        id_mapping: dict[int, int] = {}
        for ls_data in data.get("linestrings", []):
            old_id = ls_data.get("id")
            coords = ls_data.get("coords", [])
            attrs = ls_data.get("attrs", {})

            if len(coords) % 3 != 0 or len(coords) < 6:
                continue  # 跳过无效数据

            points = []
            for i in range(0, len(coords), 3):
                x, y, z = coords[i:i + 3]
                points.append(Point3d(getId(), x, y, z, {}))
            ls = LineString3d(getId(), points, dict(attrs))
            self.map.add(ls)
            if old_id is not None:
                id_mapping[old_id] = ls.id

        # 第二遍: 恢复所有 Lanelet(通过映射表重定向 left/right 引用)
        lanelet_count = 0
        for ll_data in data.get("lanelets", []):
            left_id = ll_data.get("left_id")
            right_id = ll_data.get("right_id")
            attrs = ll_data.get("attrs", {})

            new_left_id = id_mapping.get(left_id)
            new_right_id = id_mapping.get(right_id)
            if new_left_id is None or new_right_id is None:
                continue  # 跳过引用了不存在 LineString 的 Lanelet

            try:
                left = self.map.lineStringLayer[new_left_id]
                right = self.map.lineStringLayer[new_right_id]
            except (KeyError, IndexError, RuntimeError):
                continue

            ll = Lanelet(getId(), left, right, dict(attrs))
            self.map.add(ll)
            lanelet_count += 1

        return {
            "linestrings": len(id_mapping),
            "lanelets": lanelet_count,
        }

    def clear(self) -> int:
        """清空当前 map 的所有 LineString 和 Lanelet

        重新创建一个空的 LaneletMap(比逐个删除更高效、更安全)。
        返回被清空的元素总数(LineString + Lanelet)。
        """
        if not LANELET2_AVAILABLE:
            return 0
        ls_count = len(list(self.map.lineStringLayer))
        ll_count = len(list(self.map.laneletLayer))
        # 重新创建空的 map
        self.map = LaneletMap()
        return ls_count + ll_count

    def is_available(self) -> bool:
        return LANELET2_AVAILABLE
