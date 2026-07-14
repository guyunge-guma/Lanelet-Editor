#!/usr/bin/env python3
"""PCD -> LAS 转换器
自动解析 PCD 头部,按 offset 读取 x/y/z,兼容含 padding 字段的 PCD
用法: python pcd2las.py input.pcd output.las
"""
import struct
import sys
import numpy as np
import laspy


def parse_pcd_header(path):
    """解析 PCD 文件头,返回字段信息和数据偏移"""
    header = {}
    with open(path, 'rb') as f:
        while True:
            line = f.readline()
            if not line:
                break
            line = line.decode('ascii', errors='ignore').strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split()
            key = parts[0]
            vals = parts[1:]
            if key == 'DATA':
                header['data_offset'] = f.tell()
                header['data_type'] = vals[0]
                break
            elif key == 'FIELDS':
                header['fields'] = vals
            elif key == 'SIZE':
                header['size'] = [int(v) for v in vals]
            elif key == 'TYPE':
                header['type'] = vals
            elif key == 'COUNT':
                header['count'] = [int(v) for v in vals]
            elif key in ('WIDTH', 'HEIGHT', 'POINTS'):
                header[key.lower()] = int(vals[0])
            elif key == 'VERSION':
                header['version'] = vals[0] if vals else ''
    return header


def compute_offsets(header):
    """计算每个字段的字节偏移和总点大小"""
    fields = header['fields']
    sizes = header['size']
    types = header['type']
    counts = header['count']

    offsets = {}
    offset = 0
    for name, sz, t, cnt in zip(fields, sizes, types, counts):
        field_bytes = sz * cnt
        offsets[name] = (offset, sz, t, cnt)
        offset += field_bytes
    return offset, offsets  # (point_size, field_offsets)


def build_structured_dtype(header):
    """根据 PCD 头部构建 numpy structured dtype,保留所有字段(含 padding)"""
    fields = header['fields']
    sizes = header['size']
    types = header['type']
    counts = header['count']

    np_type_map = {
        ('F', 4): 'f4', ('F', 8): 'f8', ('F', 2): 'f2',
        ('U', 1): 'u1', ('U', 2): 'u2', ('U', 4): 'u4', ('U', 8): 'u8',
        ('I', 1): 'i1', ('I', 2): 'i2', ('I', 4): 'i4', ('I', 8): 'i8',
    }

    dtype_fields = []
    for i, (name, sz, t, cnt) in enumerate(zip(fields, sizes, types, counts)):
        key = (t, sz)
        np_t = np_type_map.get(key, 'f4')
        # padding 字段用唯一名字避免冲突
        field_name = f"_pad{i}" if name == '_' else name
        if cnt > 1:
            field_name = (field_name, np_t, (cnt,))
        else:
            field_name = (field_name, np_t)
        dtype_fields.append(field_name)

    return np.dtype(dtype_fields)


def read_points(path, header, structured_dtype):
    """用 structured dtype 一次性读取所有点"""
    n = header['points']
    print(f"读取 {n} 个点,dtype: {structured_dtype.itemsize} 字节/点")

    with open(path, 'rb') as f:
        f.seek(header['data_offset'])
        raw = f.read(n * structured_dtype.itemsize)

    pts = np.frombuffer(raw, dtype=structured_dtype, count=n)
    return pts


def extract_fields(pts, header):
    """从 structured array 提取 x/y/z/rgb/intensity"""
    result = {}
    names = pts.dtype.names

    for axis in ('x', 'y', 'z'):
        if axis not in names:
            raise ValueError(f"PCD 缺少 {axis} 字段")
        result[axis] = pts[axis].copy()

    if 'intensity' in names:
        result['intensity'] = pts['intensity'].copy()

    for rname in ('rgb', 'rgba'):
        if rname in names:
            val = pts[rname]
            if val.ndim == 2 and val.shape[1] >= 3:
                result['rgb'] = val[:, :3].copy()
            elif val.dtype == np.float32:
                # packed RGB float → uint32
                packed = val.view(np.uint32)
                result['rgb_r'] = (packed & 0xFF).astype(np.uint16) * 257
                result['rgb_g'] = ((packed >> 8) & 0xFF).astype(np.uint16) * 257
                result['rgb_b'] = ((packed >> 16) & 0xFF).astype(np.uint16) * 257
            break

    return result


def write_las(points, out_path):
    """写 LAS 1.4 point format 2(带 RGB)"""
    n = len(points['x'])
    print(f"写入 LAS: {n} 点 -> {out_path}")

    has_rgb = 'rgb' in points or 'rgb_r' in points
    fmt = 2 if has_rgb else 0
    las = laspy.create(file_version="1.4", point_format=fmt)
    las.header.scales = [0.001, 0.001, 0.001]
    las.header.offsets = [float(points['x'].min()),
                          float(points['y'].min()),
                          float(points['z'].min())]

    las.X = np.round((points['x'] - las.header.offsets[0]) * 1000).astype(np.int64)
    las.Y = np.round((points['y'] - las.header.offsets[1]) * 1000).astype(np.int64)
    las.Z = np.round((points['z'] - las.header.offsets[2]) * 1000).astype(np.int64)

    if 'intensity' in points:
        val = points['intensity']
        if val.dtype.kind == 'f':
            mx = float(val.max()) if val.max() > 0 else 1.0
            val = (val / mx * 65535).astype(np.uint16)
        las.intensity = val.astype(np.uint16)

    if 'rgb' in points:
        rgb = points['rgb']
        las.red = np.clip(rgb[:, 0] * 65535, 0, 65535).astype(np.uint16)
        las.green = np.clip(rgb[:, 1] * 65535, 0, 65535).astype(np.uint16)
        las.blue = np.clip(rgb[:, 2] * 65535, 0, 65535).astype(np.uint16)
    elif 'rgb_r' in points:
        las.red = points['rgb_r']
        las.green = points['rgb_g']
        las.blue = points['rgb_b']

    las.write(out_path)
    print(f"完成: {n} 点,格式 LAS 1.4 P{fmt}")


def main():
    if len(sys.argv) != 3:
        print("用法: python pcd2las.py input.pcd output.las")
        sys.exit(1)

    in_path, out_path = sys.argv[1], sys.argv[2]
    print(f"解析 PCD 头部: {in_path}")
    header = parse_pcd_header(in_path)

    point_size, offsets = compute_offsets(header)
    print(f"字段: {header['fields']}")
    print(f"每点字节数: {point_size}")
    print(f"点数: {header['points']}")

    structured_dtype = build_structured_dtype(header)
    print(f"numpy dtype itemsize: {structured_dtype.itemsize} (应等于 {point_size})")

    if structured_dtype.itemsize != point_size:
        raise ValueError(f"dtype 大小 {structured_dtype.itemsize} != PCD 点大小 {point_size}")

    pts = read_points(in_path, header, structured_dtype)
    points = extract_fields(pts, header)

    x, y, z = points['x'], points['y'], points['z']
    print(f"x 范围: [{x.min():.2f}, {x.max():.2f}]")
    print(f"y 范围: [{y.min():.2f}, {y.max():.2f}]")
    print(f"z 范围: [{z.min():.2f}, {z.max():.2f}]")

    write_las(points, out_path)


if __name__ == '__main__':
    main()
