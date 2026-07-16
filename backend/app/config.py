"""应用配置"""
from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # 服务端口
    host: str = "0.0.0.0"
    port: int = 8000

    # 数据目录(挂载到容器)
    data_dir: Path = Path("/app/data")

    # 点云目录(Potree 转换后的输出)
    pointcloud_dir: Path = Path("/app/data/pointclouds")

    # 原始上传文件目录
    raw_dir: Path = Path("/app/data/raw")

    # Lanelet2 地图 JSON 持久化文件默认路径
    map_file: Path = Path("/app/data/map.json")

    # OSM 导出目录(Lanelet2 .osm 文件输出位置)
    exports_dir: Path = Path("/app/data/exports")

    # PotreeConverter 可执行文件路径(宿主机编译后挂载)
    potreeconverter_path: str = "/opt/potreeconverter/PotreeConverter"

    # Lanelet2 原点(WGS84 经纬度)
    # 默认上海,生产环境必须修改为实际采集点
    origin_lat: float = 31.2304
    origin_lon: float = 121.4737
    # 原点高程(米),局部坐标系的 z=0 对应的椭球高
    origin_alt: float = 0.0

    # 跨域允许
    cors_origins: list[str] = ["*"]

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()

# 确保数据目录存在
settings.data_dir.mkdir(parents=True, exist_ok=True)
settings.pointcloud_dir.mkdir(parents=True, exist_ok=True)
settings.raw_dir.mkdir(parents=True, exist_ok=True)
settings.exports_dir.mkdir(parents=True, exist_ok=True)
