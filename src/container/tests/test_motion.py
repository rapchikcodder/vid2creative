"""
Tests for optical flow motion scoring.
Uses synthetic numpy frames — no fixture video required.
"""
import numpy as np
import pytest
import base64
import cv2
from pipeline.types import ExtractedFrame


def make_frame(index: int, timestamp: float, color: tuple[int, int, int]) -> ExtractedFrame:
    """Create a synthetic solid-color frame."""
    img = np.zeros((360, 640, 3), dtype=np.uint8)
    img[:] = color  # BGR
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
    _, jpeg = cv2.imencode('.jpg', img)
    return ExtractedFrame(
        index=index,
        timestamp=timestamp,
        image=img,
        jpeg_base64=base64.b64encode(jpeg.tobytes()).decode('ascii'),
    )


def make_pan_frame(index: int, timestamp: float, shift_x: int) -> ExtractedFrame:
    """
    Frame where EVERY pixel shifts right by shift_x — simulates side-scroller background pan.
    Used to test background motion subtraction: uniform pan should yield low motion_score.
    """
    img = np.zeros((90, 160, 3), dtype=np.uint8)
    # Stripe pattern so there's actual optical flow to detect
    for col in range(0, 160, 10):
        val = (col * 255 // 160)
        img[:, col:col + 5] = val
    # Shift right by rolling columns
    img = np.roll(img, shift_x, axis=1)
    _, jpeg = cv2.imencode('.jpg', img)
    return ExtractedFrame(
        index=index,
        timestamp=float(timestamp),
        image=img,
        jpeg_base64=base64.b64encode(jpeg.tobytes()).decode('ascii'),
    )


def make_noise_frame(index: int, timestamp: float, seed: int = 42) -> ExtractedFrame:
    """Random noise frame — multi-directional motion, simulates chaotic action."""
    rng = np.random.default_rng(seed)
    img = rng.integers(0, 256, (90, 160, 3), dtype=np.uint8)
    _, jpeg = cv2.imencode('.jpg', img)
    return ExtractedFrame(
        index=index,
        timestamp=float(timestamp),
        image=img,
        jpeg_base64=base64.b64encode(jpeg.tobytes()).decode('ascii'),
    )


# ── Existing tests (fixed: unpack (frames, focus_x) tuple) ─────────────────

def test_single_frame_no_crash():
    from pipeline.motion import compute_optical_flow_scores
    frames = [make_frame(0, 0.0, (100, 100, 100))]
    frames_out, focus_x = compute_optical_flow_scores(frames)
    assert len(frames_out) == 1
    assert frames_out[0].motion_score == 0.0


def test_static_frames_have_low_motion():
    from pipeline.motion import compute_optical_flow_scores
    frames = [
        make_frame(0, 0.0, (100, 100, 100)),
        make_frame(1, 1.0, (100, 100, 100)),
        make_frame(2, 2.0, (100, 100, 100)),
    ]
    frames_out, _ = compute_optical_flow_scores(frames)
    for f in frames_out:
        assert f.motion_score < 0.1, f"Static frame has high motion: {f.motion_score}"


def test_motion_frame_higher_than_static():
    from pipeline.motion import compute_optical_flow_scores
    frames = [
        make_motion_frame(0, 0.0, offset_x=50),   # rect at x=50
        make_motion_frame(1, 1.0, offset_x=200),  # rect moved (big motion)
        make_motion_frame(2, 2.0, offset_x=200),  # rect still (no motion)
    ]
    frames_out, _ = compute_optical_flow_scores(frames)
    assert frames_out[1].motion_score > frames_out[2].motion_score, (
        f"Motion frame {frames_out[1].motion_score} should beat static {frames_out[2].motion_score}"
    )


def test_all_scores_in_range():
    from pipeline.motion import compute_optical_flow_scores
    frames = [
        make_frame(0, 0.0, (50, 50, 50)),
        make_frame(1, 1.0, (200, 200, 200)),
        make_frame(2, 2.0, (50, 50, 50)),
    ]
    frames_out, _ = compute_optical_flow_scores(frames)
    for f in frames_out:
        assert 0.0 <= f.motion_score <= 1.0, f"Score out of range: {f.motion_score}"


def test_empty_frames():
    from pipeline.motion import compute_optical_flow_scores
    frames_out, focus_x = compute_optical_flow_scores([])
    assert frames_out == []
    assert focus_x == 50.0


# ── New tests ────────────────────────────────────────────────────────────────

def test_focus_x_in_range():
    """focus_x must be a float in [0.0, 100.0]."""
    from pipeline.motion import compute_optical_flow_scores
    frames = [
        make_motion_frame(0, 0.0, offset_x=50),
        make_motion_frame(1, 1.0, offset_x=200),
        make_motion_frame(2, 2.0, offset_x=400),
    ]
    _, focus_x = compute_optical_flow_scores(frames)
    assert isinstance(focus_x, float), f"focus_x should be float, got {type(focus_x)}"
    assert 0.0 <= focus_x <= 100.0, f"focus_x out of range: {focus_x}"


def test_uniform_pan_low_entropy():
    """
    Uniform rightward pan (background scroll, e.g. Subway Surfer) should yield
    low motion_score after background subtraction cancels the dominant direction.
    """
    from pipeline.motion import compute_optical_flow_scores
    # 5 frames with consistent rightward shift (uniform pan)
    frames = [make_pan_frame(i, float(i), shift_x=i * 8) for i in range(5)]
    frames_out, _ = compute_optical_flow_scores(frames)
    # Frames after the first should have low scores — pan is cancelled by subtraction
    non_first = [f.motion_score for f in frames_out[1:]]
    avg_pan_score = sum(non_first) / len(non_first)
    assert avg_pan_score < 0.45, (
        f"Uniform pan should have low avg motion_score after subtraction, got {avg_pan_score:.3f}"
    )


def test_chaotic_motion_higher_than_pan():
    """
    Random noise frames (chaotic/multi-directional motion) should score higher
    than uniform pan frames of similar raw magnitude.
    """
    from pipeline.motion import compute_optical_flow_scores
    # Pan sequence: 3 frames shifting right uniformly
    pan_frames = [make_pan_frame(i, float(i), shift_x=i * 8) for i in range(3)]
    frames_pan, _ = compute_optical_flow_scores(pan_frames)

    # Noise sequence: 3 random frames (different seeds = real motion)
    noise_frames = [make_noise_frame(i, float(i), seed=i * 7) for i in range(3)]
    frames_noise, _ = compute_optical_flow_scores(noise_frames)

    avg_pan = sum(f.motion_score for f in frames_pan) / len(frames_pan)
    avg_noise = sum(f.motion_score for f in frames_noise) / len(frames_noise)
    assert avg_noise > avg_pan, (
        f"Chaotic noise ({avg_noise:.3f}) should score higher than uniform pan ({avg_pan:.3f})"
    )


def test_focus_x_clamps_to_20_80():
    """
    focus_x must always fall in [20, 80] — the clamp range in motion.py.
    Even for degenerate inputs (single frame, static frames) the value must
    stay within that band or return the 50.0 default.
    """
    from pipeline.motion import compute_optical_flow_scores
    test_cases = [
        [make_frame(0, 0.0, (0, 0, 0))],             # single frame
        [make_frame(0, 0.0, (50, 50, 50)),
         make_frame(1, 1.0, (50, 50, 50))],           # static
        [make_motion_frame(0, 0.0, 50),
         make_motion_frame(1, 1.0, 200),
         make_motion_frame(2, 2.0, 350)],             # moving rectangle
    ]
    for frames in test_cases:
        _, focus_x = compute_optical_flow_scores(frames)
        assert 0.0 <= focus_x <= 100.0, f"focus_x {focus_x} not in [0, 100]"
        # If motion was strong enough to compute a real centroid, it must be clamped
        if focus_x != 50.0:
            assert 20.0 <= focus_x <= 80.0, f"focus_x {focus_x} outside clamp range [20, 80]"
