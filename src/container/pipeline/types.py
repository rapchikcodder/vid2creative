from pydantic import BaseModel
from dataclasses import dataclass, field
import numpy as np


@dataclass
class ExtractedFrame:
    index: int
    timestamp: float
    image: np.ndarray                  # OpenCV BGR image (H, W, 3)
    jpeg_base64: str
    motion_score: float = 0.0
    near_scene_boundary: bool = False
    scene_type: str = 'none'
    cv_confidence: float = 0.0
    # Intermediate scores computed in selector
    scene_proximity_score: float = 0.0
    motion_spike_score: float = 0.0
    temporal_score: float = 0.5


class SceneBoundary(BaseModel):
    timestamp: float
    end_timestamp: float
    duration: float
    scene_type: str   # 'content_change', 'hard_cut', 'fade'


class CandidateFrame(BaseModel):
    index: int
    timestamp: float
    motion_score: float
    near_scene_boundary: bool
    scene_type: str
    jpeg_base64: str
    cv_confidence: float
