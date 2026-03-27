"""
Tests for multi-pass frame selector.
Uses synthetic ExtractedFrame objects — no video required.
"""
import pytest
import numpy as np
import base64
import cv2
from pipeline.types import ExtractedFrame, SceneBoundary


def make_frame(index: int, timestamp: float, motion: float = 0.0) -> ExtractedFrame:
    img = np.zeros((64, 64, 3), dtype=np.uint8)
    _, jpeg = cv2.imencode('.jpg', img)
    f = ExtractedFrame(
        index=index,
        timestamp=timestamp,
        image=img,
        jpeg_base64=base64.b64encode(jpeg.tobytes()).decode('ascii'),
    )
    f.motion_score = motion
    return f


def test_basic_selection():
    from pipeline.selector import select_best_candidates
    frames = [make_frame(i, float(i), motion=float(i) / 10) for i in range(10)]
    candidates = select_best_candidates(frames, scene_boundaries=[], max_candidates=3)
    assert len(candidates) <= 3


def test_min_gap_enforced():
    from pipeline.selector import select_best_candidates
    # All high-motion frames clustered at t=0,1,2 — gap=2s should only pick 1 or 2
    frames = [
        make_frame(0, 0.0, motion=0.9),
        make_frame(1, 1.0, motion=0.95),  # within 2s of frame 0
        make_frame(2, 2.0, motion=0.85),  # within 2s of frames 0,1
        make_frame(3, 5.0, motion=0.3),   # far enough
        make_frame(4, 8.0, motion=0.2),
    ]
    candidates = select_best_candidates(frames, scene_boundaries=[], max_candidates=4, min_gap_seconds=2.0)
    timestamps = [c.timestamp for c in candidates]
    for i in range(len(timestamps)):
        for j in range(i + 1, len(timestamps)):
            diff = abs(timestamps[i] - timestamps[j])
            assert diff >= 2.0, f"Gap violation: {timestamps[i]} and {timestamps[j]} are {diff}s apart"


def test_max_candidates_limit():
    from pipeline.selector import select_best_candidates
    frames = [make_frame(i, float(i * 3), motion=0.5) for i in range(20)]
    candidates = select_best_candidates(frames, scene_boundaries=[], max_candidates=4)
    assert len(candidates) <= 4


def test_scene_proximity_boosts_score():
    from pipeline.selector import select_best_candidates
    # Frame at 5s has a scene boundary right next to it
    frames = [
        make_frame(0, 0.0, motion=0.5),
        make_frame(1, 5.0, motion=0.3),  # near scene boundary
        make_frame(2, 10.0, motion=0.5),
    ]
    boundaries = [SceneBoundary(timestamp=5.0, end_timestamp=6.0, duration=1.0, scene_type='content_change')]
    candidates = select_best_candidates(frames, scene_boundaries=boundaries, max_candidates=3, min_gap_seconds=0.5)
    # Frame at 5s should have near_scene_boundary=True
    near_boundary = [c for c in candidates if c.near_scene_boundary]
    assert len(near_boundary) >= 1


def test_empty_frames():
    from pipeline.selector import select_best_candidates
    result = select_best_candidates([], scene_boundaries=[], max_candidates=4)
    assert result == []


def test_single_frame():
    from pipeline.selector import select_best_candidates
    frames = [make_frame(0, 0.0, motion=0.5)]
    candidates = select_best_candidates(frames, scene_boundaries=[], max_candidates=4)
    assert len(candidates) == 1
    assert candidates[0].index == 0


def test_all_zero_motion():
    from pipeline.selector import select_best_candidates
    # Should still return candidates even with all-zero motion
    frames = [make_frame(i, float(i * 3), motion=0.0) for i in range(6)]
    candidates = select_best_candidates(frames, scene_boundaries=[], max_candidates=3)
    assert len(candidates) >= 1


def test_candidates_sorted_by_timestamp():
    from pipeline.selector import select_best_candidates
    frames = [make_frame(i, float(i * 3), motion=0.5) for i in range(10)]
    candidates = select_best_candidates(frames, scene_boundaries=[], max_candidates=5)
    timestamps = [c.timestamp for c in candidates]
    assert timestamps == sorted(timestamps), "Candidates not sorted by timestamp"


def test_cv_confidence_in_range():
    from pipeline.selector import select_best_candidates
    frames = [make_frame(i, float(i), motion=float(i) / 10) for i in range(10)]
    candidates = select_best_candidates(frames, scene_boundaries=[], max_candidates=5)
    for c in candidates:
        assert 0.0 <= c.cv_confidence <= 1.0, f"cv_confidence out of range: {c.cv_confidence}"
