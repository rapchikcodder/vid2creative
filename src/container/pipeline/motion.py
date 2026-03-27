"""
Optical flow motion scoring using OpenCV Farneback dense flow.

Replaces the browser-side 64×64 pixel diff with dense optical flow, which:
- Detects motion DIRECTION (not just "something changed")
- Measures motion MAGNITUDE (how fast things are moving)
- Distinguishes camera pan (uniform flow) from character action (localized flow)

Key insight: a camera pan has UNIFORM optical flow across the frame,
while a sword swing or jump has HIGH flow in a region and LOW flow elsewhere.
We measure the VARIANCE of flow magnitudes — high variance = localized action.

Final score = 0.4 * magnitude_norm + 0.6 * variance_norm
"""
import cv2
import numpy as np
from .types import ExtractedFrame

# Compute flow at reduced resolution for speed (full res is not needed)
FLOW_WIDTH = 160


def compute_optical_flow_scores(frames: list[ExtractedFrame]) -> list[ExtractedFrame]:
    """
    Compute optical flow between consecutive frames and assign motion_score 0.0-1.0.

    Args:
        frames: List of ExtractedFrame with .image set (BGR numpy arrays)

    Returns:
        Same list with .motion_score populated for each frame
    """
    if len(frames) < 2:
        # Single frame — no motion possible
        return frames

    # Resize to FLOW_WIDTH and convert to grayscale
    gray_frames: list[np.ndarray] = []
    for f in frames:
        h, w = f.image.shape[:2]
        scale = FLOW_WIDTH / w
        small = cv2.resize(f.image, (FLOW_WIDTH, int(h * scale)))
        gray_frames.append(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))

    magnitudes: list[float] = [0.0]  # first frame has no previous
    variances: list[float] = [0.0]

    for i in range(1, len(gray_frames)):
        flow = cv2.calcOpticalFlowFarneback(
            gray_frames[i - 1],
            gray_frames[i],
            None,
            pyr_scale=0.5,
            levels=3,
            winsize=15,
            iterations=3,
            poly_n=5,
            poly_sigma=1.2,
            flags=0,
        )
        # flow: (H, W, 2) — dx, dy per pixel
        mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
        magnitudes.append(float(np.mean(mag)))
        variances.append(float(np.var(mag)))

    # Normalize to 0-1
    max_mag = max(magnitudes) if max(magnitudes) > 0 else 1.0
    max_var = max(variances) if max(variances) > 0 else 1.0

    for i, frame in enumerate(frames):
        mag_norm = magnitudes[i] / max_mag
        var_norm = variances[i] / max_var
        # Variance weighted higher: localized action scores above camera pans
        frame.motion_score = round(0.4 * mag_norm + 0.6 * var_norm, 4)

    return frames
