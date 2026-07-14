"""PCD -> LAS 转换器(纯 Python,numpy + laspy 实现)

支持:
- DATA binary(最常见)
- 任意字段顺序(按 offset 精确读取)
- padding 字段 `_`
- COUNT > 1 的字段(如 rgb)
- F/U/I 类型(1/2/4/8 字节)

不支持:
- DATA ascii(纯文本,后续可扩展)
- DATA binary_compressed(LZF 压缩)
"""
from __future__ import annotations

import struct
from pathlib import Path
from typing import Any

import numpy as np

try:
    import laspy
    LASPY_AVAILABLE = True
except ImportError:
    LASPY_AVAILABLE = False


class PcdParseError(Exception):
    """PCD 解析错误"""


# numpy 类型映射: (TYPE, SIZE) -> numpy dtype 字符
_TYPE_MAP = {
    ("F", 4): "f4", ("F", 8): "f8",
    ("U", 1): "u1", ("U", 2): "u2", ("U", 4): "u4", ("U", 8): "u8",
    ("I", 1): "i1", ("I", 2): "i2", ("I", 4): "i4", ("I", 8): "i8",
}


def _parse_header(f) -> dict[str, Any]:
    """解析 PCD 文件头(ASCII 部分,直到 DATA 行)"""
    header: dict[str, Any] = {}
    while True:
        line = f.readline()
        if not line:
            raise PcdParseError("意外的文件结束,未找到 DATA 行")
        line = line.decode("ascii", errors="ignore").strip()
        if not line or line.startswith("#"):
            continue

        key, *vals = line.split()
        if key in ("VERSION", "DATA"):
            header[key.lower()] = vals[0] if vals else ""
        elif key == "FIELDS":
            header["fields"] = vals
        elif key == "SIZE":
            header["size"] = [int(v) for v in vals]
        elif key == "TYPE":
            header["type"] = vals
        elif key == "COUNT":
            header["count"] = [int(v) for v in vals]
        elif key in ("WIDTH", "HEIGHT", "POINTS"):
            header[key.lower()] = int(vals[0])
        elif key == "VIEWPOINT":
            header["viewpoint"] = vals

        if key == "DATA":
            header["data_offset"] = f.tell()
            break

    # 校验
    for required in ("fields", "size", "type", "count", "width", "height", "points"):
        if required not in header:
            raise PcdParseError(f"PCD 头部缺少必填字段: {required}")

    return header


def _build_dtype(header: dict) -> np.dtype:
    """根据 PCD 头部构建 numpy structured dtype"""
    fields = header["fields"]
    sizes = header["size"]
    types = header["type"]
    counts = header["count"]

    field_specs: list[tuple[str, Any]] = []
    for name, sz, t, cnt in zip(fields, sizes, types, counts):
        if name == "_":
            continue  # 跳过 padding
        np_t = _TYPE_MAP.get((t, sz))
        if np_t is None:
            raise PcdParseError(f"不支持的字段类型: ({t}, {sz}) 字段={name}")
        dt = np.dtype(np_t)
        if cnt > 1:
            dt = np.dtype((dt, cnt))
        field_specs.append((name, dt))

    return np.dtype(field_specs)


def pcd_to_las(pcd_path: str | Path, las_path: str | Path) -> dict[str, Any]:
    """PCD 文件转 LAS 文件

    返回统计信息 dict
    """
    if not LASPY_AVAILABLE:
        raise RuntimeError("laspy 未安装,pip install laspy")

    pcd_path = Path(pcd_path)
    las_path = Path(las_path)

    with pcd_path.open("rb") as f:
        header = _parse_header(f)
        data_format = header.get("data", "binary")

        if data_format != "binary":
            raise PcdParseError(
                f"暂不支持 DATA={data_format},仅支持 binary。"
                f"ascii/binary_compressed 后续可扩展"
            )

        np_dtype = _build_dtype(header)
        point_size = np_dtype.itemsize
        n_points = header["points"]

        # 读取二进制数据
        f.seek(header["data_offset"])
        raw = f.read(n_points * point_size)
        if len(raw) < n_points * point_size:
            raise PcdParseError(
                f"数据不足: 期望 {n_points * point_size} 字节,实际 {len(raw)} 字节"
            )

        points = np.frombuffer(raw, dtype=np_dtype, count=n_points)

    # 提取 x/y/z(必填)
    field_names = points.dtype.names or []
    if "x" not in field_names or "y" not in field_names or "z" not in field_names:
        raise PcdParseError(f"PCD 缺少 x/y/z 字段,现有字段: {field_names}")

    x = points["x"].astype(np.float64)
    y = points["y"].astype(np.float64)
    z = points["z"].astype(np.float64)

    # 写 LAS 1.4 point format 2(含 RGB)
    las = laspy.create(file_version="1.4", point_format=2)
    las.header.scales = [0.001, 0.001, 0.001]
    las.header.offsets = [float(x.min()), float(y.min()), float(z.min())]

    las.X = ((x - las.header.offsets[0]) / 0.001).astype(np.int64)
    las.Y = ((y - las.header.offsets[1]) / 0.001).astype(np.int64)
    las.Z = ((z - las.header.offsets[2]) / 0.001).astype(np.int64)

    # 可选: RGB
    if "rgb" in field_names:
        rgb = points["rgb"]
        if rgb.ndim == 1:
            # 单个 float32,可能是 packed RGB
            rgb_int = rgb.view(np.uint32) if rgb.dtype == np.float32 else rgb.astype(np.uint32)
            las.red = (rgb_int & 0xFFFF).astype(np.uint16)
            las.green = ((rgb_int >> 16) & 0xFFFF).astype(np.uint16)
            las.blue = np.zeros(n_points, dtype=np.uint16)
        else:
            # 多通道 [N, 3] 或 [N, 4]
            las.red = (rgb[:, 0] * 65535).clip(0, 65535).astype(np.uint16)
            las.green = (rgb[:, 1] * 65535).clip(0, 65535).astype(np.uint16)
            las.blue = (rgb[:, 2] * 65535).clip(0, 65535).astype(np.uint16) if rgb.shape[1] > 2 else np.zeros(n_points, dtype=np.uint16)

    # 可选: intensity
    if "intensity" in field_names:
        intensity = points["intensity"]
        if intensity.dtype.kind == "f":
            las.intensity = (intensity * 65535).clip(0, 65535).astype(np.uint16)
        else:
            las.intensity = intensity.astype(np.uint16)

    las.write(str(las_path))

    return {
        "points": int(n_points),
        "fields": list(field_names),
        "point_size": point_size,
        "x_range": [float(x.min()), float(x.max())],
        "y_range": [float(y.min()), float(y.max())],
        "z_range": [float(z.min()), float(z.max())],
        "las_path": str(las_path),
        "las_size": int(las_path.stat().st_size),
    }
