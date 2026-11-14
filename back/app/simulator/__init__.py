"""Rotation engine package import bundle.

Exposes the core simulator objects so application code can do::

    from app.simulator import Rotator, SoilProfile, build_soil_profile
"""

from . import engine as simulator
from .engine import (
    Rotator,
    SoilProfile,
    Crop,
    CropDatabase,
    build_soil_profile,
    default_climate,
    scenario_from_deltas,
)

__all__ = [
    "simulator",
    "Rotator",
    "SoilProfile",
    "Crop",
    "CropDatabase",
    "build_soil_profile",
    "default_climate",
    "scenario_from_deltas",
]

__version__ = "0.1.0"
