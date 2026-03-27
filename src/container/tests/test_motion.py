"""
Tests for optical flow motion scoring.
Uses synthetic numpy frames — no fixture video required.
"""
import numpy as np
import pytest
from pipeline.types import ExtractedFrame


def make_frame(index: int, timestamp: float, color: tuple[int, int, int]) -> ExtractedFrame:
    """Create a synthetic solid-color frame."""
    img = np.zeros((360, 640, 3), dtype=np.uint8)
    img[:] = color  # BGR
    import base64, cv2
    _, jpeg = cv2.imencode('.jpg', img)
    return ExtractedFrame(
        index=index,
        timestamp=timestamp,
        image=img,
        jpeg_base64=base64.b64encode(jpeg.tobytes()).decode('ascii'),
    )


def make_motion_frame(index: int, timestamp: float, offset_x: int = 50) -> ExtractedFrame:
    """Create a frame with a moving rectangle to generate optical flow."""
    img = np.zeros((360, 640, 3), dtype=np.uint8)
    img[100:200, offset_x:offset_x + 100] = (0, 255, 0)  # green rectangle
    import base64, cv2
    _, jpeg = cv2.imencode('.jpg', img)
    return ExtractedFrame(
        index=index,
        timestamp=timestamp,
        image=img,
        jpeg_base64=base64.b64encode(jpeg.tobytes()).decode('ascii'),
    )


def test_single_frame_no_crash():
    from pipeline.motion import compute_optical_flow_scores
    frames = [make_frame(0, 0.0, (100, 100, 100))]
    result = compute_optical_flow_scores(frames)
    assert len(result) == 1
    assert result[0].motion_score == 0.0


def test_static_frames_have_low_motion():
    from pipeline.motion import compute_optical_flow_scores
    # Two identical frames → no motion
    frames = [
        make_frame(0, 0.0, (100, 100, 100)),
        make_frame(1, 1.0, (100, 100, 100)),
        make_frame(2, 2.0, (100, 100, 100)),
    ]
    result = compute_optical_flow_scores(frames)
    # All scores should be near 0 (at most a tiny amount of JPEG compression noise)
    for f in result:
        assert f.motion_score < 0.1, f"Static frame has high motion: {f.motion_score}"


def test_motion_frame_higher_than_static():
    from pipeline.motion import compute_optical_flow_scores
    frames = [
        make_motion_frame(0, 0.0, offset_x=50),    # rect at x=50
        make_motion_frame(1, 1.0, offset_x=200),   # rect moved to x=200 (big motion)
        make_motion_frame(2, 2.0, offset_x=200),   # rect still (no motion)
    ]
    result = compute_optical_flow_scores(frames)
    # Frame 1 (motion) should score higher than frame 2 (static)
    assert result[1].motion_score > result[2].motion_score, (
        f"Motion frame {result[1].motion_score} should beat static {result[2].motion_score}"
    )


def test_all_scores_in_range():
    from pipeline.motion import compute_optical_flow_scores
    frames = [
        make_frame(0, 0.0, (50, 50, 50)),
        make_frame(1, 1.0, (200, 200, 200)),
        make_frame(2, 2.0, (50, 50, 50)),
    ]
    result = compute_optical_flow_scores(frames)
    for f in result:
        assert 0.0 <= f.motion_score <= 1.0, f"Score out of range: {f.motion_score}"


def test_empty_frames():
    from pipeline.motion import compute_optical_flow_scores
    result = compute_optical_flow_scores([])
    assert result == []
