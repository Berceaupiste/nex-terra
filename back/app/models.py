"""Pydantic request/response models for the NEX TERRA API."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


# --------------------------------------------------------------------------- #
#  Request payloads
# --------------------------------------------------------------------------- #
class FieldUpdate(BaseModel):
    field_code: str
    lat: float
    lon: float
    region: str
    area_ha: float
    previous_crops: List[str] = Field(default_factory=list)
    irrigation: str = "rainfed"
    soil: Optional[Dict[str, Any]] = None

    @field_validator("lat")
    @classmethod
    def lat_in_range(cls, v: float) -> float:
        if not (-90.0 <= v <= 90.0):
            raise ValueError("Latitude must be between -90 and 90")
        return v

    @field_validator("lon")
    @classmethod
    def lon_in_range(cls, v: float) -> float:
        if not (-180.0 <= v <= 180.0):
            raise ValueError("Longitude must be between -180 and 180")
        return v


class RotationRequest(BaseModel):
    crops: List[str] = Field(default_factory=list, min_length=1, max_length=6)
    soil: Optional[Dict[str, Any]] = None
    climate: Optional[Dict[str, Any]] = None


class ScenarioRequest(BaseModel):
    scenario_id: str = Field(default="default_scenario")


# --------------------------------------------------------------------------- #
#  Response payloads
# --------------------------------------------------------------------------- #
class SeasonMetric(BaseModel):
    index: int
    crop: str
    water_mm: float
    n_balance_kg: float
    resilience: float
    soil_protection: float
    econom_inc: float


class RotationResult(BaseModel):
    id: str
    rotations: int
    rotation: List[str]
    name: Optional[str] = None
    water_total_mm: float
    water_avg_mm: float
    water_cap_factor: float
    n_balance_kg: float
    n_balance_per_season_kg: float
    resilience_avg: float
    soil_protection_avg: float
    economic_potential_avg: float
    econ_per_water_mad_m3: float
    score: float
    scenarios: Dict[str, Any] = Field(default_factory=dict)
    seasons: List[SeasonMetric] = Field(default_factory=list)
    nasa: Dict[str, Any] = Field(default_factory=dict)


class FieldResult(BaseModel):
    field_code: str
    name: str
    region: str
    lat: float
    lon: float
    area_ha: float
    terrain: str
    irrigation: str
    soil: Dict[str, Any]
    previous_crops: List[str]


class ScenariosResult(BaseModel):
    scenarios: List[Dict[str, Any]]


class ComparisonItem(BaseModel):
    id: str
    name: str
    rotation: List[str]
    water_total_mm: float
    n_balance_kg: float
    resilience_avg: float
    soil_protection_avg: float
    economic_potential_avg: float
    econ_per_water_mad_m3: float
    score: float


class OptimizationResult(BaseModel):
    optimized_rotation: List[str]
    score: Optional[float]
    n_evals: Optional[int]
    success: Optional[bool]


class ErrorResponse(BaseModel):
    detail: str
    code: int = 400


# --------------------------------------------------------------------------- #
#  Helpers
# --------------------------------------------------------------------------- #
def _normalize_crops(crops: List[str]) -> List[str]:
    return [c.strip() for c in crops]


def _weather_label(sc: Dict[str, Any]) -> str:
    """Human readable label for a climate scenario."""
    ts = sc.get("temp_shift", 0.0)
    pd = sc.get("precipitation", 1.0)
    dr = sc.get("drought", 0.0)
    clover = ""
    if ts > 0:
        clover += f"+{ts:.1f}C"
    if 0 < pd < 1:
        clover += f" / {pd * 100:.0f}% rain"
    elif pd > 1:
        clover += f" +{(pd-1)*100:.0f}% rain"
    if dr > 0:
        clover += f" / drought {dr:.2f}"
    return clover or "baseline"


def _write_demo_field() -> FieldResult:
    """Write the virtual Settat field to the SQLite DB (mirrors a MAP layer)."""
    from .routes import _ensure_db
    return _ensure_db().get_field("SET-001")


# Rebuild all Pydantic models so ForwardRef annotations resolve after the model
# classes are fully defined. FastAPI's auto-body parsing wraps each request model
# in Annotated[ForwardRef(model), FieldInfo(...)] which requires a rebuild.
for _cls in (RotationRequest, FieldUpdate, ScenarioRequest, SeasonMetric,
             RotationResult, FieldResult, ComparisonItem, ErrorResponse,
             OptimizationResult):
    _cls.model_rebuild(force=True)