"""Lanelet2 核心服务

封装 lanelet2 Python 库,提供 Point/LineString/Lanelet 的创建与 OSM 导入导出。
注意: lanelet2 的 API 在不同版本间略有差异,本代码基于 1.2.x。
"""
from __future__ import annotations

import json
import math
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

# GPSPoint / BasicPoint3d 在不同 lanelet2 版本中位置不同,防御性导入
if LANELET2_AVAILABLE:
    try:
        from lanelet2.io import GPSPoint  # type: ignore
    except ImportError:
        try:
            from lanelet2.core import GPSPoint  # type: ignore
        except ImportError:
            GPSPoint = None
    try:
        from lanelet2.core import BasicPoint3d  # type: ignore
    except ImportError:
        BasicPoint3d = None
else:
    GPSPoint = None
    BasicPoint3d = None

# RegulatoryElement 的原生 API 在不同 lanelet2 版本间差异较大,
# 单独做一层守卫导入: 不可用时降级为「纯 Python 侧存储」(仍可 JSON 持久化与列表/查询)。
try:
    from lanelet2.core import RegulatoryElementFactory as _RegulatoryElementFactory  # type: ignore
    _RE_NATIVE_AVAILABLE = True
except ImportError:
    _RegulatoryElementFactory = None  # type: ignore
    _RE_NATIVE_AVAILABLE = False

from .config import settings


class Lanelet2Service:
    """Lanelet2 地图管理服务(每个项目一个实例)"""

    def __init__(self, origin_lat: float | None = None, origin_lon: float | None = None,
                 origin_alt: float | None = None):
        self.origin_lat = origin_lat if origin_lat is not None else settings.origin_lat
        self.origin_lon = origin_lon if origin_lon is not None else settings.origin_lon
        self.origin_alt = origin_alt if origin_alt is not None else settings.origin_alt
        # lanelet2 未安装时降级为 None,避免 NameError
        self.origin = self._make_origin(self.origin_lat, self.origin_lon, self.origin_alt)
        # 局部坐标 -> WGS84 投影器
        self.projector = UtmProjector(self.origin) if LANELET2_AVAILABLE else None
        self.map = LaneletMap() if LANELET2_AVAILABLE else None

        # 第 5 轮: 红绿灯 / 停止线 / RegulatoryElement 的逻辑存储
        # lanelet2 原生 RegulatoryElement API 跨版本差异较大,这里以 Python 侧字典为
        # 权威存储(用于列表/查询/更新/删除/JSON 持久化),并尽可能在 lanelet2 map 中
        # 创建对应的 Point3d(红绿灯位置)/标记 LineString(停止线)/原生 RegulatoryElement,
        # 以便 OSM 导出与 Autoware 对接。原生创建失败不影响逻辑存储。
        self._traffic_lights: dict[int, dict[str, Any]] = {}
        self._stop_lines: dict[int, dict[str, Any]] = {}
        self._regulatory_elements: dict[int, dict[str, Any]] = {}

    @staticmethod
    def _make_origin(lat: float, lon: float, alt: float):
        """构造 lanelet2 Origin,兼容不同版本对 altitude 参数的支持"""
        if not LANELET2_AVAILABLE:
            return None
        try:
            return Origin(lat, lon, alt)
        except TypeError:
            # 旧版本 Origin 仅接受 (lat, lon)
            return Origin(lat, lon)

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
        """导出为 Lanelet2 .osm 文件

        使用 lanelet2 的 write(message, filepath) API,包含当前 map 中的
        所有 LineString、Lanelet、RegulatoryElement。projector 内部已包含 origin,
        因此导出的 OSM 节点为 WGS84 经纬度。
        """
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")
        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path = str(out_path)
        # lanelet2 的 write 签名: write(path, map, projector)
        # projector 内部已包含 origin,不需要额外传 origin 参数
        write(out_path, self.map, self.projector)
        return out_path

    def import_osm(self, in_path: str | Path) -> dict[str, int]:
        """导入 .osm 文件,重建内存中的所有对象

        使用 lanelet2 的 load(filepath) API。导入前会清空当前 map,
        导入后返回统计信息。
        返回: {linestring_count, lanelet_count, regulatory_count}
        """
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")

        in_path = str(in_path)
        if not Path(in_path).exists():
            raise FileNotFoundError(f"OSM 文件不存在: {in_path}")

        # 清空现有数据再导入(避免与旧数据混合)
        self.clear()

        # load 返回 (LaneletMap, projector),projector 复用当前原点
        self.map, _ = load(in_path, self.projector)

        # 统计导入结果
        linestring_count = len(list(self.map.lineStringLayer))
        lanelet_count = len(list(self.map.laneletLayer))
        regulatory_count = 0
        reg_layer = getattr(self.map, "regulatoryElementLayer", None)
        if reg_layer is not None:
            try:
                regulatory_count = len(list(reg_layer))
            except Exception:
                regulatory_count = 0

        return {
            "linestring_count": linestring_count,
            "lanelet_count": lanelet_count,
            "regulatory_count": regulatory_count,
        }

    # ---------- 坐标系对齐(原点 / 局部坐标 <-> GPS) ----------

    def set_origin(self, lat: float, lon: float, alt: float = 0.0) -> dict[str, float]:
        """设置投影原点(WGS84 经纬度 + 高程)

        注意: 修改原点不会对已有 map 中的局部坐标做反向平移,已有几何数据仍停留在
        旧原点对应的局部坐标系中。建议在导入/新建地图前先设置好原点。
        """
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")
        self.origin_lat = float(lat)
        self.origin_lon = float(lon)
        self.origin_alt = float(alt)
        self.origin = self._make_origin(self.origin_lat, self.origin_lon, self.origin_alt)
        self.projector = UtmProjector(self.origin)
        return self.get_origin()

    def get_origin(self) -> dict[str, float]:
        """获取当前原点 {lat, lon, alt}"""
        return {
            "lat": float(self.origin_lat),
            "lon": float(self.origin_lon),
            "alt": float(self.origin_alt),
        }

    def local_to_gps(self, x: float, y: float, z: float = 0.0) -> dict[str, float]:
        """局部坐标 -> GPS(UTM 反投影)

        利用 UtmProjector.reverse 将局部度量坐标反投影为 WGS84 经纬度。
        返回 {lat, lon, alt}
        """
        if not LANELET2_AVAILABLE or self.projector is None:
            raise RuntimeError("lanelet2 库未安装")
        gps = self._reverse_project(x, y, z)
        lat = float(getattr(gps, "lat", 0.0))
        lon = float(getattr(gps, "lon", 0.0))
        alt = float(getattr(gps, "alt", getattr(gps, "ele", z)))
        return {"lat": lat, "lon": lon, "alt": alt}

    def gps_to_local(self, lat: float, lon: float, alt: float = 0.0) -> dict[str, float]:
        """GPS -> 局部坐标(UTM 正投影)

        利用 UtmProjector.forward 将 WGS84 经纬度投影为局部度量坐标。
        返回 {x, y, z}
        """
        if not LANELET2_AVAILABLE or self.projector is None:
            raise RuntimeError("lanelet2 库未安装")
        pt = self._forward_project(lat, lon, alt)
        return {
            "x": float(pt.x),
            "y": float(pt.y),
            "z": float(getattr(pt, "z", alt)),
        }

    def _reverse_project(self, x: float, y: float, z: float):
        """局部坐标 -> GPSPoint,兼容不同 lanelet2 版本的 reverse 签名"""
        # 优先用 Point3d(需要 id)
        try:
            pt = Point3d(getId(), x, y, z)
            return self.projector.reverse(pt)
        except Exception:
            pass
        # 回退到 BasicPoint3d(无 id 的纯坐标点)
        if BasicPoint3d is not None:
            try:
                return self.projector.reverse(BasicPoint3d(x, y, z))
            except Exception:
                pass
        raise RuntimeError("projector.reverse 调用失败,无法完成局部坐标到 GPS 的反投影")

    def _forward_project(self, lat: float, lon: float, alt: float):
        """GPSPoint -> 局部坐标点,兼容不同 lanelet2 版本的 forward 签名"""
        gps = None
        if GPSPoint is not None:
            try:
                gps = GPSPoint(lat, lon, alt)
            except TypeError:
                try:
                    gps = GPSPoint(lat, lon)
                except Exception as e:
                    raise RuntimeError(f"无法构造 GPSPoint: {e}") from e
        if gps is None:
            raise RuntimeError("GPSPoint 不可用,无法完成 GPS 到局部坐标的投影")
        try:
            return self.projector.forward(gps)
        except Exception as e:
            raise RuntimeError(f"projector.forward 调用失败: {e}") from e

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

    # ---------- Lanelet 单元素查询 / 修改 / 删除 ----------

    def get_lanelet(self, ll_id: int) -> dict[str, Any] | None:
        """获取单个 Lanelet(含左右边界坐标)

        返回 {id, left_id, right_id, attrs, left_coords, right_coords}
        不存在返回 None。
        """
        if not LANELET2_AVAILABLE:
            return None
        try:
            ll = self.map.laneletLayer[ll_id]
        except (KeyError, IndexError, RuntimeError):
            return None

        left = ll.leftBound
        right = ll.rightBound
        left_coords: list[float] = []
        for p in left:
            left_coords.extend([p.x, p.y, p.z])
        right_coords: list[float] = []
        for p in right:
            right_coords.extend([p.x, p.y, p.z])
        return {
            "id": ll.id,
            "left_id": left.id,
            "right_id": right.id,
            "attrs": dict(ll.attributes),
            "left_coords": left_coords,
            "right_coords": right_coords,
        }

    def update_lanelet(
        self,
        ll_id: int,
        left_id: int | None = None,
        right_id: int | None = None,
        attrs: dict[str, str] | None = None,
    ) -> int:
        """更新 Lanelet 的左右边界或属性

        由于 lanelet2 的 Lanelet 创建后绑定关系固定,需先删除旧 Lanelet 再创建新的。
        - left_id / right_id 为 None 时保留原值
        - attrs 为 None 时保留原属性,否则整体替换为新属性
        返回新的 Lanelet ID。
        """
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")

        try:
            old_ll = self.map.laneletLayer[ll_id]
        except (KeyError, IndexError, RuntimeError) as e:
            raise ValueError(f"Lanelet {ll_id} 不存在") from e

        # 未提供的字段保留原值
        new_left_id = left_id if left_id is not None else old_ll.leftBound.id
        new_right_id = right_id if right_id is not None else old_ll.rightBound.id
        final_attrs = dict(old_ll.attributes) if attrs is None else dict(attrs)

        # 校验左右边界 LineString 存在(在删除旧 Lanelet 之前校验,避免半成品状态)
        try:
            new_left = self.map.lineStringLayer[new_left_id]
            new_right = self.map.lineStringLayer[new_right_id]
        except (KeyError, IndexError, RuntimeError) as e:
            raise ValueError(
                f"左右边界 LineString 不存在: left={new_left_id}, right={new_right_id}"
            ) from e

        # 删除旧 Lanelet 后创建新的
        self.map.laneletLayer.erase(old_ll)
        new_ll = Lanelet(getId(), new_left, new_right, final_attrs)
        self.map.add(new_ll)
        return new_ll.id

    def delete_lanelet(self, ll_id: int) -> bool:
        """删除 Lanelet,不存在返回 False"""
        if not LANELET2_AVAILABLE:
            return False
        try:
            ll = self.map.laneletLayer[ll_id]
        except (KeyError, IndexError, RuntimeError):
            return False
        self.map.laneletLayer.erase(ll)
        return True

    # ---------- 拓扑关系(前驱/后继) ----------

    def set_lanelet_relations(
        self,
        ll_id: int,
        predecessor_ids: list[int] | None,
        successor_ids: list[int] | None,
    ) -> bool:
        """设置 Lanelet 的前驱/后继关系

        简化实现: 将关系存储在 Lanelet 的 attributes 中,
        "predecessor" / "successor" 为逗号分隔的 ID 字符串。
        - None: 不修改该方向的关系
        - 空列表: 清除该方向的关系(删除对应 attribute)
        - 非空列表: 设置为逗号分隔字符串
        """
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")
        try:
            ll = self.map.laneletLayer[ll_id]
        except (KeyError, IndexError, RuntimeError) as e:
            raise ValueError(f"Lanelet {ll_id} 不存在") from e

        attrs = ll.attributes
        if predecessor_ids is not None:
            if len(predecessor_ids) == 0:
                # 清除前驱关系
                try:
                    del attrs["predecessor"]
                except KeyError:
                    pass
            else:
                attrs["predecessor"] = ",".join(str(i) for i in predecessor_ids)

        if successor_ids is not None:
            if len(successor_ids) == 0:
                # 清除后继关系
                try:
                    del attrs["successor"]
                except KeyError:
                    pass
            else:
                attrs["successor"] = ",".join(str(i) for i in successor_ids)
        return True

    def get_lanelet_relations(self, ll_id: int) -> dict[str, Any] | None:
        """获取 Lanelet 的前驱/后继关系

        返回 {id, predecessor: [int], successor: [int]}
        不存在返回 None。
        """
        if not LANELET2_AVAILABLE:
            return None
        try:
            ll = self.map.laneletLayer[ll_id]
        except (KeyError, IndexError, RuntimeError):
            return None

        attrs = dict(ll.attributes)
        return {
            "id": ll.id,
            "predecessor": self._parse_id_list(attrs.get("predecessor", "")),
            "successor": self._parse_id_list(attrs.get("successor", "")),
        }

    def get_all_relations(self) -> list[dict[str, Any]]:
        """获取所有 Lanelet 的拓扑关系"""
        if not LANELET2_AVAILABLE:
            return []
        result = []
        for ll in self.map.laneletLayer:
            attrs = dict(ll.attributes)
            result.append({
                "id": ll.id,
                "predecessor": self._parse_id_list(attrs.get("predecessor", "")),
                "successor": self._parse_id_list(attrs.get("successor", "")),
            })
        return result

    @staticmethod
    def _parse_id_list(raw: str) -> list[int]:
        """将逗号分隔的 ID 字符串解析为 int 列表"""
        if not raw:
            return []
        ids: list[int] = []
        for part in raw.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                ids.append(int(part))
            except ValueError:
                continue
        return ids

    # ---------- Lanelet 可视化几何数据 ----------

    def get_lanelet_geometry(self, ll_id: int) -> dict[str, Any] | None:
        """获取 Lanelet 的几何数据(左右边界坐标数组,用于前端绘制面片和方向箭头)

        返回 {id, left_id, right_id, left_coords, right_coords}
        不存在返回 None。
        """
        if not LANELET2_AVAILABLE:
            return None
        try:
            ll = self.map.laneletLayer[ll_id]
        except (KeyError, IndexError, RuntimeError):
            return None

        left = ll.leftBound
        right = ll.rightBound
        left_coords: list[float] = []
        for p in left:
            left_coords.extend([p.x, p.y, p.z])
        right_coords: list[float] = []
        for p in right:
            right_coords.extend([p.x, p.y, p.z])
        return {
            "id": ll.id,
            "left_id": left.id,
            "right_id": right.id,
            "left_coords": left_coords,
            "right_coords": right_coords,
        }

    def list_lanelets_with_geometry(self) -> list[dict[str, Any]]:
        """列出所有 Lanelet 带几何数据(左右边界坐标)"""
        if not LANELET2_AVAILABLE:
            return []
        result = []
        for ll in self.map.laneletLayer:
            left = ll.leftBound
            right = ll.rightBound
            left_coords: list[float] = []
            for p in left:
                left_coords.extend([p.x, p.y, p.z])
            right_coords: list[float] = []
            for p in right:
                right_coords.extend([p.x, p.y, p.z])
            result.append({
                "id": ll.id,
                "left_id": left.id,
                "right_id": right.id,
                "attrs": dict(ll.attributes),
                "left_coords": left_coords,
                "right_coords": right_coords,
            })
        return result

    # ---------- RegulatoryElement(红绿灯/停止线/斑马线/交通标志的统一逻辑容器) ----------
    #
    # 设计说明:
    # lanelet2 原生 RegulatoryElement API 在不同版本间签名差异较大(RuleParameter /
    # RegulatoryElementFactory 等),直接依赖会让服务在不同环境上不稳定。因此本服务采用
    # 「Python 侧字典为权威存储 + 尽力创建原生 RegulatoryElement」的混合策略:
    #   - 列表/查询/更新/删除/JSON 持久化 全部基于 Python 侧字典,保证稳定可降级;
    #   - 创建时尽力调用 RegulatoryElementFactory 在 lanelet2 map 中生成原生对象,
    #     以便 OSM 导出与 Autoware 对接;失败则静默跳过,不影响逻辑存储。

    _RE_TYPES: set[str] = {"traffic_light", "stop_line", "crosswalk", "traffic_sign"}

    def add_regulatory_element(
        self,
        rl_type: str,
        lanelet_ids: list[int],
        attrs: dict[str, str] | None = None,
    ) -> int:
        """创建 RegulatoryElement

        rl_type: 'traffic_light' | 'stop_line' | 'crosswalk' | 'traffic_sign'
        lanelet_ids: 关联的 Lanelet ID 列表(不存在的会被自动过滤)
        attrs: 属性字典
        返回新创建的 RegulatoryElement ID。
        """
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")
        if rl_type not in self._RE_TYPES:
            raise ValueError(
                f"不支持的 regulatory element 类型: {rl_type},"
                f"可选: {sorted(self._RE_TYPES)}"
            )

        # 过滤出真实存在的 Lanelet
        valid_lanelet_ids = self._filter_existing_lanelet_ids(lanelet_ids)

        re_id = getId()
        final_attrs: dict[str, str] = {"type": rl_type}
        if attrs:
            final_attrs.update(attrs)

        record: dict[str, Any] = {
            "id": re_id,
            "type": rl_type,
            "lanelet_ids": valid_lanelet_ids,
            "attrs": final_attrs,
        }

        # 尽力在 lanelet2 map 中创建原生 RegulatoryElement(用于 OSM 导出)
        self._try_create_native_regulatory_element(record)

        self._regulatory_elements[re_id] = record
        return re_id

    def list_regulatory_elements(self) -> list[dict[str, Any]]:
        """列出所有 RegulatoryElement"""
        if not LANELET2_AVAILABLE:
            return []
        return [self._copy_record(r) for r in self._regulatory_elements.values()]

    def get_regulatory_element(self, re_id: int) -> dict[str, Any] | None:
        """获取单个 RegulatoryElement,不存在返回 None"""
        if not LANELET2_AVAILABLE:
            return None
        r = self._regulatory_elements.get(re_id)
        return self._copy_record(r) if r else None

    def update_regulatory_element(
        self,
        re_id: int,
        rl_type: str | None = None,
        lanelet_ids: list[int] | None = None,
        attrs: dict[str, str] | None = None,
    ) -> dict[str, Any] | None:
        """更新 RegulatoryElement

        - rl_type / lanelet_ids / attrs 为 None 时保留原值
        - attrs 非 None 时合并到现有属性(type 字段始终跟随 rl_type)
        返回更新后的完整记录;不存在返回 None。
        """
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")
        r = self._regulatory_elements.get(re_id)
        if r is None:
            return None

        changed = False
        if rl_type is not None:
            if rl_type not in self._RE_TYPES:
                raise ValueError(
                    f"不支持的 regulatory element 类型: {rl_type},"
                    f"可选: {sorted(self._RE_TYPES)}"
                )
            r["type"] = rl_type
            r["attrs"]["type"] = rl_type
            changed = True
        if lanelet_ids is not None:
            r["lanelet_ids"] = self._filter_existing_lanelet_ids(lanelet_ids)
            changed = True
        if attrs is not None:
            r["attrs"].update(attrs)
            # 保证 type 字段与 rl_type 一致
            r["attrs"]["type"] = r["type"]
            changed = True

        if changed:
            # 原生对象无法原地修改,先删除再重建
            self._erase_native_regulatory_element(re_id)
            self._try_create_native_regulatory_element(r)

        return self._copy_record(r)

    def delete_regulatory_element(self, re_id: int) -> bool:
        """删除 RegulatoryElement,不存在返回 False"""
        if not LANELET2_AVAILABLE:
            return False
        removed = self._regulatory_elements.pop(re_id, None)
        if removed is None:
            return False
        self._erase_native_regulatory_element(re_id)
        return True

    # ---- RegulatoryElement 原生对象辅助 ----

    def _try_create_native_regulatory_element(self, record: dict[str, Any]) -> None:
        """尽力在 lanelet2 map 中创建原生 RegulatoryElement,失败则静默跳过"""
        if not _RE_NATIVE_AVAILABLE or _RegulatoryElementFactory is None:
            return
        try:
            lanelets = []
            for lid in record.get("lanelet_ids", []):
                try:
                    lanelets.append(self.map.laneletLayer[lid])
                except (KeyError, IndexError, RuntimeError):
                    continue
            re_id = record["id"]
            role = record["type"]
            re_obj = None
            # 优先用关联 Lanelet 作为 rules;签名不兼容则回退到空 rules
            try:
                re_obj = _RegulatoryElementFactory.create(re_id, role, {}, lanelets)
            except Exception:
                try:
                    re_obj = _RegulatoryElementFactory.create(re_id, role, {}, [])
                except Exception:
                    re_obj = None
            if re_obj is not None:
                self.map.add(re_obj)
        except Exception:
            # 任何异常都不影响 Python 侧逻辑存储
            return

    def _erase_native_regulatory_element(self, re_id: int) -> None:
        """从 lanelet2 map 的 regulatoryElementLayer 中删除原生对象(若存在)"""
        if not LANELET2_AVAILABLE:
            return
        layer = getattr(self.map, "regulatoryElementLayer", None)
        if layer is None:
            return
        try:
            re_obj = layer[re_id]
            layer.erase(re_obj)
        except Exception:
            pass

    def _filter_existing_lanelet_ids(self, lanelet_ids: list[int] | None) -> list[int]:
        """过滤出当前 map 中真实存在的 Lanelet ID(去重,保留顺序)"""
        if not lanelet_ids:
            return []
        seen: set[int] = set()
        valid: list[int] = []
        for lid in lanelet_ids:
            if lid in seen:
                continue
            try:
                self.map.laneletLayer[lid]
            except (KeyError, IndexError, RuntimeError):
                continue
            seen.add(lid)
            valid.append(lid)
        return valid

    @staticmethod
    def _copy_record(record: dict[str, Any]) -> dict[str, Any]:
        """深拷贝一条逻辑记录(避免外部修改内部状态)"""
        out = dict(record)
        out["lanelet_ids"] = list(record.get("lanelet_ids", []))
        out["attrs"] = dict(record.get("attrs", {}))
        return out

    # ---------- TrafficLight(红绿灯) ----------
    #
    # 红绿灯用 lanelet2 的 Point3d 标记位置(attributes.type=traffic_light),
    # 朝向 / 关联车道等 metadata 存储在 Python 侧字典中,一并持久化到 JSON。

    def add_traffic_light(
        self,
        position: list[float],
        orientation: list[float] | None = None,
        lanelet_id: int | None = None,
        attrs: dict[str, str] | None = None,
    ) -> int:
        """创建红绿灯

        position: [x, y, z]
        orientation: [yaw, pitch, roll](可省略,缺省为 0)
        lanelet_id: 关联的车道(可选,不存在则抛 ValueError)
        attrs: 额外属性
        返回新创建的 TrafficLight 逻辑 ID。
        """
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")
        if not position or len(position) != 3:
            raise ValueError("position 必须是 [x, y, z]")

        x, y, z = float(position[0]), float(position[1]), float(position[2])
        ori = list(orientation) if orientation else [0.0, 0.0, 0.0]
        while len(ori) < 3:
            ori.append(0.0)
        yaw, pitch, roll = float(ori[0]), float(ori[1]), float(ori[2])

        if lanelet_id is not None:
            try:
                self.map.laneletLayer[lanelet_id]
            except (KeyError, IndexError, RuntimeError) as e:
                raise ValueError(f"Lanelet {lanelet_id} 不存在") from e

        # 在 lanelet2 map 中创建 Point3d 标记红绿灯位置(便于 OSM 导出)
        point_attrs: dict[str, str] = {"type": "traffic_light"}
        if attrs:
            point_attrs.update(attrs)
        p = Point3d(getId(), x, y, z, point_attrs)
        self.map.add(p)

        tl_id = getId()
        self._traffic_lights[tl_id] = {
            "id": tl_id,
            "position": [x, y, z],
            "orientation": [yaw, pitch, roll],
            "lanelet_id": lanelet_id,
            "attrs": dict(attrs) if attrs else {},
            "point_id": p.id,
        }
        return tl_id

    def list_traffic_lights(self) -> list[dict[str, Any]]:
        """列出所有红绿灯"""
        if not LANELET2_AVAILABLE:
            return []
        return [self._copy_traffic_light(tl) for tl in self._traffic_lights.values()]

    def delete_traffic_light(self, tl_id: int) -> bool:
        """删除红绿灯(同时尽量删除 map 中的 Point3d),不存在返回 False"""
        if not LANELET2_AVAILABLE:
            return False
        rec = self._traffic_lights.pop(tl_id, None)
        if rec is None:
            return False
        point_id = rec.get("point_id")
        if point_id is not None:
            self._erase_point(point_id)
        return True

    @staticmethod
    def _copy_traffic_light(record: dict[str, Any]) -> dict[str, Any]:
        out = dict(record)
        out["position"] = list(record.get("position", []))
        out["orientation"] = list(record.get("orientation", []))
        out["attrs"] = dict(record.get("attrs", {}))
        return out

    def _erase_point(self, point_id: int) -> None:
        """从 lanelet2 map 的 pointLayer 中删除点(若存在)"""
        if not LANELET2_AVAILABLE:
            return
        layer = getattr(self.map, "pointLayer", None)
        if layer is None:
            return
        try:
            p = layer[point_id]
            layer.erase(p)
        except Exception:
            pass

    # ---------- StopLine(停止线) ----------
    #
    # 停止线复用已存在的 LineString3d 作为几何,创建时把该 LineString 的 type 标记为
    # stop_line(遵循 lanelet2 约定),并在 Python 侧字典中记录其与 Lanelet 的关联。

    def add_stop_line(
        self,
        linestring_id: int,
        lanelet_id: int | None = None,
    ) -> int:
        """创建停止线(关联一条已存在的 LineString + 可选 Lanelet)

        linestring_id: 停止线对应的 LineString ID(必须已存在)
        lanelet_id: 关联的车道(可选,不存在则抛 ValueError)
        返回新创建的 StopLine 逻辑 ID。
        """
        if not LANELET2_AVAILABLE:
            raise RuntimeError("lanelet2 库未安装")
        try:
            ls = self.map.lineStringLayer[linestring_id]
        except (KeyError, IndexError, RuntimeError) as e:
            raise ValueError(f"LineString {linestring_id} 不存在") from e

        if lanelet_id is not None:
            try:
                self.map.laneletLayer[lanelet_id]
            except (KeyError, IndexError, RuntimeError) as e:
                raise ValueError(f"Lanelet {lanelet_id} 不存在") from e

        # 标记 LineString 为停止线(遵循 lanelet2 约定 type=stop_line)
        try:
            ls.attributes["type"] = "stop_line"
        except Exception:
            pass

        sl_id = getId()
        self._stop_lines[sl_id] = {
            "id": sl_id,
            "linestring_id": linestring_id,
            "lanelet_id": lanelet_id,
        }
        return sl_id

    def list_stop_lines(self) -> list[dict[str, Any]]:
        """列出所有停止线"""
        if not LANELET2_AVAILABLE:
            return []
        return [dict(sl) for sl in self._stop_lines.values()]

    def delete_stop_line(self, sl_id: int) -> bool:
        """删除停止线(仅删除关联记录,不删除底层 LineString),不存在返回 False"""
        if not LANELET2_AVAILABLE:
            return False
        return self._stop_lines.pop(sl_id, None) is not None

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
          ],
          "traffic_lights": [
            {"id": 789, "position": [x,y,z], "orientation": [yaw,pitch,roll],
             "lanelet_id": 456, "attrs": {...}, "point_id": 1001}
          ],
          "stop_lines": [
            {"id": 800, "linestring_id": 123, "lanelet_id": 456}
          ],
          "regulatory_elements": [
            {"id": 900, "type": "traffic_light", "lanelet_ids": [456], "attrs": {...}}
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

        # 序列化 TrafficLight / StopLine / RegulatoryElement(第 5 轮新增)
        traffic_lights = [self._copy_traffic_light(tl) for tl in self._traffic_lights.values()]
        stop_lines = [dict(sl) for sl in self._stop_lines.values()]
        regulatory_elements = [self._copy_record(r) for r in self._regulatory_elements.values()]

        data = {
            "linestrings": linestrings,
            "lanelets": lanelets,
            "traffic_lights": traffic_lights,
            "stop_lines": stop_lines,
            "regulatory_elements": regulatory_elements,
        }

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
        # 同时建立 lanelet 的 old_id -> new_id 映射,供 TrafficLight/StopLine/
        # RegulatoryElement 重新关联车道使用。
        lanelet_count = 0
        ll_id_mapping: dict[int, int] = {}
        for ll_data in data.get("lanelets", []):
            old_ll_id = ll_data.get("id")
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
            if old_ll_id is not None:
                ll_id_mapping[old_ll_id] = ll.id
            lanelet_count += 1

        # 第三遍: 恢复 TrafficLight(重建 Point3d,重定向 lanelet_id / point_id)
        traffic_light_count = 0
        for tl_data in data.get("traffic_lights", []):
            position = tl_data.get("position", [0.0, 0.0, 0.0]) or [0.0, 0.0, 0.0]
            orientation = tl_data.get("orientation", [0.0, 0.0, 0.0]) or [0.0, 0.0, 0.0]
            attrs = tl_data.get("attrs", {}) or {}
            old_lanelet_id = tl_data.get("lanelet_id")
            new_lanelet_id = (
                ll_id_mapping.get(old_lanelet_id) if old_lanelet_id is not None else None
            )

            # 重建 Point3d
            point_attrs: dict[str, str] = {"type": "traffic_light"}
            point_attrs.update(attrs)
            new_point_id = None
            try:
                if len(position) >= 3:
                    p = Point3d(
                        getId(),
                        float(position[0]), float(position[1]), float(position[2]),
                        point_attrs,
                    )
                    self.map.add(p)
                    new_point_id = p.id
            except Exception:
                new_point_id = None

            new_tl_id = getId()
            self._traffic_lights[new_tl_id] = {
                "id": new_tl_id,
                "position": [float(position[0]), float(position[1]), float(position[2])]
                if len(position) >= 3 else [0.0, 0.0, 0.0],
                "orientation": [float(orientation[i]) if len(orientation) > i else 0.0
                                for i in range(3)],
                "lanelet_id": new_lanelet_id,
                "attrs": dict(attrs),
                "point_id": new_point_id,
            }
            traffic_light_count += 1

        # 第四遍: 恢复 StopLine(重定向 linestring_id / lanelet_id,重新标记 type)
        stop_line_count = 0
        for sl_data in data.get("stop_lines", []):
            old_ls_id = sl_data.get("linestring_id")
            old_lanelet_id = sl_data.get("lanelet_id")
            new_ls_id = id_mapping.get(old_ls_id)
            if new_ls_id is None:
                continue  # 关联的 LineString 已丢失,跳过
            new_lanelet_id = (
                ll_id_mapping.get(old_lanelet_id) if old_lanelet_id is not None else None
            )
            # 重新标记 LineString 为停止线
            try:
                ls = self.map.lineStringLayer[new_ls_id]
                ls.attributes["type"] = "stop_line"
            except Exception:
                pass
            new_sl_id = getId()
            self._stop_lines[new_sl_id] = {
                "id": new_sl_id,
                "linestring_id": new_ls_id,
                "lanelet_id": new_lanelet_id,
            }
            stop_line_count += 1

        # 第五遍: 恢复 RegulatoryElement(重定向 lanelet_ids,尽力重建原生对象)
        re_count = 0
        for re_data in data.get("regulatory_elements", []):
            rl_type = re_data.get("type")
            if rl_type not in self._RE_TYPES:
                continue  # 跳过未知类型
            old_lanelet_ids = re_data.get("lanelet_ids", []) or []
            attrs = re_data.get("attrs", {}) or {}
            new_lanelet_ids = [
                ll_id_mapping[i] for i in old_lanelet_ids if i in ll_id_mapping
            ]
            new_re_id = getId()
            final_attrs: dict[str, str] = {"type": rl_type}
            final_attrs.update(attrs)
            final_attrs["type"] = rl_type
            record = {
                "id": new_re_id,
                "type": rl_type,
                "lanelet_ids": new_lanelet_ids,
                "attrs": final_attrs,
            }
            self._try_create_native_regulatory_element(record)
            self._regulatory_elements[new_re_id] = record
            re_count += 1

        return {
            "linestrings": len(id_mapping),
            "lanelets": lanelet_count,
            "traffic_lights": traffic_light_count,
            "stop_lines": stop_line_count,
            "regulatory_elements": re_count,
        }

    def clear(self) -> int:
        """清空当前 map 的所有 LineString / Lanelet 及第 5 轮新增的交通信号元素

        重新创建一个空的 LaneletMap(比逐个删除更高效、更安全)。
        返回被清空的元素总数(LineString + Lanelet + TrafficLight + StopLine + RegulatoryElement)。
        """
        if not LANELET2_AVAILABLE:
            return 0
        ls_count = len(list(self.map.lineStringLayer))
        ll_count = len(list(self.map.laneletLayer))
        tl_count = len(self._traffic_lights)
        sl_count = len(self._stop_lines)
        re_count = len(self._regulatory_elements)
        # 重新创建空的 map
        self.map = LaneletMap()
        self._traffic_lights.clear()
        self._stop_lines.clear()
        self._regulatory_elements.clear()
        return ls_count + ll_count + tl_count + sl_count + re_count

    # ---------- 拓扑校验 ----------

    def validate_topology(self) -> list[dict[str, Any]]:
        """拓扑校验(纯计算,不修改数据)

        检查项:
        - isolated: 孤立车道(没有前驱也没有后继)
        - dangling: 断头路(前驱/后继引用了不存在的 Lanelet)
        - direction_conflict: 方向冲突(前驱/后继关系不对称,如 A 称 B 为后继,
          但 B 未称 A 为前驱)

        返回: [{type, lanelet_id, message}]
        """
        if not LANELET2_AVAILABLE:
            return []

        # 收集所有 Lanelet 的拓扑关系
        relations: dict[int, dict[str, list[int]]] = {}
        for ll in self.map.laneletLayer:
            attrs = dict(ll.attributes)
            relations[ll.id] = {
                "predecessor": self._parse_id_list(attrs.get("predecessor", "")),
                "successor": self._parse_id_list(attrs.get("successor", "")),
            }

        existing_ids = set(relations.keys())
        results: list[dict[str, Any]] = []

        for ll_id, rel in relations.items():
            pred = rel["predecessor"]
            succ = rel["successor"]

            # 1) 孤立车道
            if not pred and not succ:
                results.append({
                    "type": "isolated",
                    "lanelet_id": ll_id,
                    "message": f"车道 {ll_id} 没有前驱也没有后继(孤立车道)",
                })

            # 2) 断头路: 引用了不存在的 Lanelet
            for ref_id in pred:
                if ref_id not in existing_ids:
                    results.append({
                        "type": "dangling",
                        "lanelet_id": ll_id,
                        "message": f"车道 {ll_id} 的前驱 {ref_id} 不存在(断头路)",
                    })
            for ref_id in succ:
                if ref_id not in existing_ids:
                    results.append({
                        "type": "dangling",
                        "lanelet_id": ll_id,
                        "message": f"车道 {ll_id} 的后继 {ref_id} 不存在(断头路)",
                    })

            # 3) 方向冲突: 前驱/后继关系不对称
            for p in pred:
                if p in relations and ll_id not in relations[p]["successor"]:
                    results.append({
                        "type": "direction_conflict",
                        "lanelet_id": ll_id,
                        "message": (
                            f"车道 {ll_id} 的前驱 {p} 未将其列为后继(方向冲突)"
                        ),
                    })
            for s in succ:
                if s in relations and ll_id not in relations[s]["predecessor"]:
                    results.append({
                        "type": "direction_conflict",
                        "lanelet_id": ll_id,
                        "message": (
                            f"车道 {ll_id} 的后继 {s} 未将其列为前驱(方向冲突)"
                        ),
                    })

        # 4) 空间间隙: 两个 Lanelet 没有拓扑关系,但端点距离很近
        #    这通常意味着用户忘记连接前驱/后继
        GAP_THRESHOLD = 5.0  # 米
        ll_list = list(self.map.laneletLayer)
        for i in range(len(ll_list)):
            ll_a = ll_list[i]
            a_rel = relations.get(ll_a.id, {})
            a_succ = set(a_rel.get("successor", []))
            a_pred = set(a_rel.get("predecessor", []))
            # 获取 a 的终点(左边界最后一个点)
            try:
                a_end = ll_a.leftBound[-1]
            except (IndexError, RuntimeError):
                continue
            for j in range(i + 1, len(ll_list)):
                ll_b = ll_list[j]
                # 跳过已有拓扑关系的
                if ll_b.id in a_succ or ll_b.id in a_pred:
                    continue
                b_rel = relations.get(ll_b.id, {})
                if ll_a.id in set(b_rel.get("successor", [])) or ll_a.id in set(b_rel.get("predecessor", [])):
                    continue
                # 获取 b 的起点(左边界第一个点)
                try:
                    b_start = ll_b.leftBound[0]
                except (IndexError, RuntimeError):
                    continue
                dist = ((a_end.x - b_start.x) ** 2 + (a_end.y - b_start.y) ** 2 + (a_end.z - b_start.z) ** 2) ** 0.5
                if dist < GAP_THRESHOLD:
                    results.append({
                        "type": "gap",
                        "lanelet_id": ll_a.id,
                        "message": (
                            f"车道 {ll_a.id} 与 {ll_b.id} 端点距离 {dist:.2f}m"
                            f"(阈值 {GAP_THRESHOLD}m),可能需要设置拓扑关系"
                        ),
                    })

        return results

    # ---------- 几何校验 ----------

    # LineString 重叠判定阈值(米),小于该距离视为重叠/过近
    GEOMETRY_OVERLAP_THRESHOLD: float = 0.05

    def validate_geometry(self) -> list[dict[str, Any]]:
        """几何校验(纯计算,不修改数据)

        检查项:
        - overlap: 两条 LineString 距离过近(平行重叠或相交),且不共享顶点
        - self_intersect: 单条 LineString 自相交
        - boundary_cross: Lanelet 左右边界交叉

        返回: [{type, id, message}]
        """
        if not LANELET2_AVAILABLE:
            return []

        results: list[dict[str, Any]] = []

        # 取出所有 LineString 的二维坐标
        linestrings: list[tuple[int, list[tuple[float, float]]]] = []
        for ls in self.map.lineStringLayer:
            pts = [(float(p.x), float(p.y)) for p in ls]
            if len(pts) >= 2:
                linestrings.append((ls.id, pts))

        # 1) 自相交检查
        for ls_id, pts in linestrings:
            if self._has_self_intersection(pts):
                results.append({
                    "type": "self_intersect",
                    "id": ls_id,
                    "message": f"LineString {ls_id} 存在自相交",
                })

        # 2) 重叠检查(两两比较,带整体 bbox 预筛)
        for i in range(len(linestrings)):
            id_a, pts_a = linestrings[i]
            bbox_a = self._bbox(pts_a)
            for j in range(i + 1, len(linestrings)):
                id_b, pts_b = linestrings[j]
                bbox_b = self._bbox(pts_b)
                if not self._bbox_overlap(bbox_a, bbox_b,
                                         self.GEOMETRY_OVERLAP_THRESHOLD):
                    continue
                # 共享顶点则视为正常衔接(如路口接驳),不算重叠
                if self._share_vertex(pts_a, pts_b):
                    continue
                min_dist = self._linestrings_min_distance(pts_a, pts_b)
                if min_dist < self.GEOMETRY_OVERLAP_THRESHOLD:
                    results.append({
                        "type": "overlap",
                        "id": id_a,
                        "message": (
                            f"LineString {id_a} 与 LineString {id_b} "
                            f"距离过近(最小距离 {min_dist:.3f}m,可能重叠或相交)"
                        ),
                    })

        # 3) Lanelet 左右边界交叉检查
        for ll in self.map.laneletLayer:
            left_pts = [(float(p.x), float(p.y)) for p in ll.leftBound]
            right_pts = [(float(p.x), float(p.y)) for p in ll.rightBound]
            if len(left_pts) < 2 or len(right_pts) < 2:
                continue
            if self._polylines_cross(left_pts, right_pts):
                results.append({
                    "type": "boundary_cross",
                    "id": ll.id,
                    "message": f"Lanelet {ll.id} 的左右边界发生交叉",
                })

        return results

    # ---- 几何辅助方法(2D,忽略 z) ----

    @staticmethod
    def _bbox(pts: list[tuple[float, float]]) -> tuple[float, float, float, float]:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return (min(xs), min(ys), max(xs), max(ys))

    @staticmethod
    def _bbox_overlap(a: tuple[float, float, float, float],
                      b: tuple[float, float, float, float],
                      eps: float = 0.0) -> bool:
        return not (a[2] < b[0] - eps or b[2] < a[0] - eps
                    or a[3] < b[1] - eps or b[3] < a[1] - eps)

    @staticmethod
    def _share_vertex(pts_a: list[tuple[float, float]],
                      pts_b: list[tuple[float, float]],
                      eps: float = 1e-6) -> bool:
        set_b = {(round(x / eps), round(y / eps)) for x, y in pts_b} if eps else set(pts_b)
        for x, y in pts_a:
            key = (round(x / eps), round(y / eps)) if eps else (x, y)
            if key in set_b:
                return True
        return False

    @staticmethod
    def _has_self_intersection(pts: list[tuple[float, float]]) -> bool:
        """检查折线是否自相交(仅检查非相邻线段对)

        - 相邻线段(共享顶点)默认不算自相交
        - 闭合折线(首尾点重合)的首尾段(0, n-2)共享闭合顶点,亦跳过
        """
        n = len(pts)
        if n < 4:
            return False
        eps = 1e-9
        closed = (abs(pts[0][0] - pts[-1][0]) < eps
                  and abs(pts[0][1] - pts[-1][1]) < eps)
        for i in range(n - 1):
            for j in range(i + 2, n - 1):
                # 闭合折线的首尾段共享闭合顶点,跳过
                if closed and i == 0 and j == n - 2:
                    continue
                if _seg_intersect_2d(pts[i], pts[i + 1], pts[j], pts[j + 1]):
                    return True
        return False

    @staticmethod
    def _polylines_cross(a: list[tuple[float, float]],
                         b: list[tuple[float, float]]) -> bool:
        """检查两条折线的任意线段对是否相交(含端点落在对方线段上)"""
        for i in range(len(a) - 1):
            for j in range(len(b) - 1):
                if _seg_intersect_2d(a[i], a[i + 1], b[j], b[j + 1]):
                    return True
        return False

    @staticmethod
    def _linestrings_min_distance(a: list[tuple[float, float]],
                                  b: list[tuple[float, float]]) -> float:
        """两条折线之间的最小线段-线段距离"""
        min_d = float("inf")
        for i in range(len(a) - 1):
            for j in range(len(b) - 1):
                d = _seg_seg_dist_2d(a[i], a[i + 1], b[j], b[j + 1])
                if d < min_d:
                    min_d = d
                    if min_d == 0.0:
                        return 0.0
        return min_d

    def is_available(self) -> bool:
        return LANELET2_AVAILABLE


# ---- 模块级几何辅助函数(2D 线段运算) ----

_GEOM_EPS = 1e-9


def _orient(ax: float, ay: float, bx: float, by: float,
            cx: float, cy: float) -> int:
    """向量 ab x ac 的符号"""
    val = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if val > _GEOM_EPS:
        return 1
    if val < -_GEOM_EPS:
        return -1
    return 0


def _on_segment(ax: float, ay: float, bx: float, by: float,
                cx: float, cy: float) -> bool:
    """共线前提下,点 c 是否在线段 ab 上"""
    return (min(ax, bx) - _GEOM_EPS <= cx <= max(ax, bx) + _GEOM_EPS
            and min(ay, by) - _GEOM_EPS <= cy <= max(ay, by) + _GEOM_EPS)


def _seg_intersect_2d(p1: tuple[float, float], p2: tuple[float, float],
                      p3: tuple[float, float], p4: tuple[float, float]) -> bool:
    """判断二维线段 p1p2 与 p3p4 是否相交(含端点重合 / 共线重叠)"""
    ax, ay = p1
    bx, by = p2
    cx, cy = p3
    dx, dy = p4
    d1 = _orient(cx, cy, dx, dy, ax, ay)
    d2 = _orient(cx, cy, dx, dy, bx, by)
    d3 = _orient(ax, ay, bx, by, cx, cy)
    d4 = _orient(ax, ay, bx, by, dx, dy)
    if d1 != d2 and d3 != d4:
        return True
    if d1 == 0 and _on_segment(cx, cy, dx, dy, ax, ay):
        return True
    if d2 == 0 and _on_segment(cx, cy, dx, dy, bx, by):
        return True
    if d3 == 0 and _on_segment(ax, ay, bx, by, cx, cy):
        return True
    if d4 == 0 and _on_segment(ax, ay, bx, by, dx, dy):
        return True
    return False


def _point_seg_dist_2d(px: float, py: float,
                       ax: float, ay: float,
                       bx: float, by: float) -> float:
    """点 p 到线段 ab 的二维距离"""
    dx = bx - ax
    dy = by - ay
    if abs(dx) < _GEOM_EPS and abs(dy) < _GEOM_EPS:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx = ax + t * dx
    cy = ay + t * dy
    return math.hypot(px - cx, py - cy)


def _seg_seg_dist_2d(p1: tuple[float, float], p2: tuple[float, float],
                     p3: tuple[float, float], p4: tuple[float, float]) -> float:
    """两条二维线段之间的最小距离(相交则为 0)"""
    if _seg_intersect_2d(p1, p2, p3, p4):
        return 0.0
    return min(
        _point_seg_dist_2d(p1[0], p1[1], p3[0], p3[1], p4[0], p4[1]),
        _point_seg_dist_2d(p2[0], p2[1], p3[0], p3[1], p4[0], p4[1]),
        _point_seg_dist_2d(p3[0], p3[1], p1[0], p1[1], p2[0], p2[1]),
        _point_seg_dist_2d(p4[0], p4[1], p1[0], p1[1], p2[0], p2[1]),
    )
