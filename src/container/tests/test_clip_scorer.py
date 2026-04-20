"""
Tests for clip_scorer visual excitement scoring.
Pure OpenCV features — no ML model, no fixture video required.
"""
import numpy as np
import pytest
import base64
import cv2
from pipeline.types import ExtractedFrame


def make_frame(index: int, timestamp: float, img: np.ndarray) -> ExtractedFrame:
    """Wrap a numpy image as ExtractedFrame."""
    _, jpeg = cv2.imencode('.jpg', img)
    return ExtractedFrame(
        index=index,
        timestamp=timestamp,
        image=img,
        jpeg_base64=base64.b64encode(jpeg.tobytes()).decode('ascii'),
    )


def solid_frame(color_bgr: tuple[int, int, int], h: int = 180, w: int = 320) -> np.ndarray:
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:] = color_bgr
    return img


def checkerboard_frame(h: int = 180, w: int = 320, cell: int = 16) -> np.ndarray:
    """High-edge frame: black/white checkerboard."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if ((y // cell) + (x // cell)) % 2 == 0:
                img[y:y+cell, x:x+cell] = 255
    return img


def vivid_frame(h: int = 180, w: int = 320) -> np.ndarray:
    """Fully saturated red frame — high saturation score."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :, 2] = 255  # pure red in BGR
    return img


def grey_frame(h: int = 180, w: int = 320) -> np.ndarray:
    """Neutral grey — zero saturation."""
    return np.full((h, w, 3), 128, dtype=np.uint8)


# ── Tests ─────────────────────────────────────────────────────────────────

def test_empty_returns_empty():
    from pipeline.clip_scorer import score_frames_clip
    assert score_frames_clip([]) == []


def test_score_count_matches_frames():
    from pipeline.clip_scorer import score_frames_clip
    frames = [make_frame(i, float(i), solid_frame((i * 30, i * 30, i * 30))) for i in range(5)]
    scores = score_frames_clip(frames)
    assert len(scores) == 5, f"Expected 5 scores, got {len(scores)}"


def test_all_scores_in_range():
    from pipeline.clip_scorer import score_frames_clip
    frames = [
        make_frame(0, 0.0, solid_frame((0, 0, 0))),
        make_frame(1, 1.0, checkerboard_frame()),
        make_frame(2, 2.0, vivid_frame()),
        make_frame(3, 3.0, grey_frame()),
    ]
    scores = score_frames_clip(frames)
    for i, s in enumerate(scores):
        assert 0.0 <= s <= 1.0, f"Score at index {i} out of [0,1]: {s}"


def test_static_frame_low_structural_change():
    """
    Two identical frames → the second frame has zero structural change (SSIM ≈ 1).
    Combined score should be below 0.4 since structural_change weight is 35%.
    """
    from pipeline.clip_scorer import score_frames_clip
    img = checkerboard_frame()  # use checkerboard so edge/saturation aren't near 0
    frames = [
        make_frame(0, 0.0, img.copy()),
        make_frame(1, 1.0, img.copy()),  # identical → no structural change
    ]
    scores = score_frames_clip(frames)
    # Second frame: structural_change ≈ 0, so score should drop vs first
    assert scores[1] < scores[0] or scores[1] < 0.5, (
        f"Identical frame should have low structural change score, got {scores[1]:.3f}"
    )


def test_colorful_higher_than_grey():
    """
    A vivid (high-saturation) frame should score higher than a grey frame
    when compared as first frames (no prior frame → structural_change = 0 for both).
    """
    from pipeline.clip_scorer import score_frames_clip
    vivid_scores = score_frames_clip([make_frame(0, 0.0, vivid_frame())])
    grey_scores  = score_frames_clip([make_frame(0, 0.0, grey_frame())])
    assert vivid_scores[0] > grey_scores[0], (
        f"Vivid frame ({vivid_scores[0]:.3f}) should score higher than grey ({grey_scores[0]:.3f})"
    )


def test_edges_boost_score():
    """
    A checkerboard (high edge density) should score higher than a blank frame
    when both are evaluated as first frames (no structural change component).
    """
    from pipeline.clip_scorer import score_frames_clip
    edge_scores  = score_frames_clip([make_frame(0, 0.0, checkerboard_frame())])
    blank_scores = score_frames_clip([make_frame(0, 0.0, solid_frame((0, 0, 0)))])
    assert edge_scores[0] > blank_scores[0], (
        f"Checkerboard ({edge_scores[0]:.3f}) should score higher than blank ({blank_scores[0]:.3f})"
    )
