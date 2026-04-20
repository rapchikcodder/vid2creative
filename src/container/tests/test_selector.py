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


# ── detect_all_actions tests ──────────────────────────────────────────────

def test_detect_actions_returns_scored_frames():
    """detect_all_actions returns (list[ScoredFrame], list[ActionCluster])."""
    from pipeline.selector import detect_all_actions
    from pipeline.types import ScoredFrame, ActionCluster
    frames = [make_frame(i, float(i * 2), motion=0.6) for i in range(6)]
    scored, clusters = detect_all_actions(frames, scene_boundaries=[])
    assert len(scored) == len(frames), "scored frames count should match input"
    assert isinstance(clusters, list)
    for sf in scored:
        assert isinstance(sf, ScoredFrame)
        assert 0.0 <= sf.cv_confidence <= 1.0


def test_detect_actions_clustering():
    """
    3 high-motion frames within 1.5s gap should merge into 1 cluster.
    1 isolated high-motion frame far away should be its own cluster.
    """
    from pipeline.selector import detect_all_actions
    frames = [
        make_frame(0, 0.0,  motion=0.9),   # cluster A
        make_frame(1, 0.5,  motion=0.85),  # cluster A
        make_frame(2, 1.0,  motion=0.88),  # cluster A  (within 1.5s of frame 0)
        make_frame(3, 10.0, motion=0.8),   # cluster B  (far away)
    ]
    scored, clusters = detect_all_actions(
        frames, scene_boundaries=[], action_threshold=0.40, cluster_gap_seconds=1.5
    )
    assert len(clusters) == 2, f"Expected 2 clusters, got {len(clusters)}: {[(c.start_timestamp, c.end_timestamp) for c in clusters]}"
    # First cluster should span t=0..1
    c0 = min(clusters, key=lambda c: c.start_timestamp)
    assert c0.frame_count == 3, f"First cluster should have 3 frames, got {c0.frame_count}"


def test_adaptive_threshold_fallback():
    """
    All frames score well below action_threshold (0.35).
    Adaptive fallback must mark at least 3 frames as is_action=True.
    """
    from pipeline.selector import detect_all_actions
    # motion=0.05 → cv_confidence ≈ 0.05*0.40 + ... ≈ 0.05–0.10, well below 0.35
    frames = [make_frame(i, float(i * 3), motion=0.05) for i in range(8)]
    scored, clusters = detect_all_actions(
        frames, scene_boundaries=[], action_threshold=0.35
    )
    action_count = sum(1 for sf in scored if sf.is_action)
    assert action_count >= 3, (
        f"Adaptive fallback should guarantee ≥3 action frames, got {action_count}"
    )


def test_detect_actions_empty():
    """Empty input returns empty lists without crashing."""
    from pipeline.selector import detect_all_actions
    scored, clusters = detect_all_actions([], scene_boundaries=[])
    assert scored == []
    assert clusters == []
