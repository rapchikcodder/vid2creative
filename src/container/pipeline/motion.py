"""
Optical flow motion scoring using OpenCV Farneback dense flow.

Three signals extracted from optical flow:

1. **Magnitude** — how fast things are moving overall
2. **Magnitude variance** — localized vs uniform motion
   (high variance = character action, low = camera pan)
3. **Direction entropy** — THE KEY DISCRIMINATOR for action detection.
   Action scenes have chaotic multi-directional motion (fighting, explosions,
   particles flying everywhere). Boring scenes have uniform motion in one
   direction (character walking, camera panning). Direction entropy measures
   how spread out the motion directions are across the frame.

Final score = 0.20 * magnitude + 0.20 * variance + 0.40 * direction_entropy + 0.20 * coverage

This correctly scores:
  - Character fighting  -> high mag, high var, HIGH entropy -> ~0.9
  - Explosion/ability   -> high mag, high var, HIGH entropy -> ~0.85
  - Character walking   -> mid mag, LOW var, LOW entropy   -> ~0.25
  - Camera pan          -> mid mag, LOW var, LOW entropy   -> ~0.15
  - Menu/idle           -> low mag, low var, low entropy    -> ~0.05
"""
import cv2
import numpy as np
from .types import ExtractedFrame

FLOW_WIDTH = 160
DIRECTION_BINS = 8  # 8 compass directions (N, NE, E, SE, S, SW, W, NW)
MIN_FLOW_MAG = 0.5  # Ignore near-zero flow pixels (noise)


def _direction_entropy(angles: np.ndarray, magnitudes: np.ndarray) -> float:
    """
    Shannon entropy of optical flow direction histogram.

    Only counts pixels with magnitude > MIN_FLOW_MAG to avoid noise.
    Returns value in [0, 1] where 1 = perfectly uniform directions (max chaos).
    """
    mask = magnitudes > MIN_FLOW_MAG
    if mask.sum() < 10:
        return 0.0

    active_angles = angles[mask]
    hist, _ = np.histogram(active_angles, bins=DIRECTION_BINS, range=(0, 360))
    hist = hist.astype(np.float64)
    total = hist.sum()
    if total == 0:
        return 0.0

    probs = hist / total
    probs = probs[probs > 0]

    entropy = -np.sum(probs * np.log2(probs))
    max_entropy = np.log2(DIRECTION_BINS)  # 3.0 for 8 bins
    return float(entropy / max_entropy)


def _flow_coverage(magnitudes: np.ndarray) -> float:
    """Fraction of pixels with significant motion. Action affects more of the frame."""
    return float((magnitudes > MIN_FLOW_MAG).sum() / max(magnitudes.size, 1))


def compute_optical_flow_scores(frames: list[ExtractedFrame]) -> tuple[list[ExtractedFrame], float]:
    """
    Compute optical flow between consecutive frames and assign motion_score 0.0-1.0.

    Uses direction entropy as the dominant signal — distinguishes real action
    (multi-directional chaos) from simple movement (unidirectional walking/panning).

    Also computes horizontal focus point (0-100%) from the weighted motion centroid.
    This tells portrait-crop where to center so the main character stays in frame.

    Returns:
        (frames_with_scores, focus_x_percent)
    """
    if len(frames) < 2:
        return frames, 50.0

    gray_frames: list[np.ndarray] = []
    for f in frames:
        h, w = f.image.shape[:2]
        scale = FLOW_WIDTH / w
        small = cv2.resize(f.image, (FLOW_WIDTH, int(h * scale)))
        gray_frames.append(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))

    mags: list[float] = [0.0]
    vars_: list[float] = [0.0]
    entropies: list[float] = [0.0]
    coverages: list[float] = [0.0]

    # Track weighted horizontal centroid of motion for character focus
    total_mag_weight = 0.0
    weighted_x_sum = 0.0

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
        mag, ang = cv2.cartToPolar(flow[..., 0], flow[..., 1], angleInDegrees=True)
        mags.append(float(np.mean(mag)))
        vars_.append(float(np.var(mag)))
        entropies.append(_direction_entropy(ang, mag))
        coverages.append(_flow_coverage(mag))

        # Accumulate horizontal centroid of CHARACTER motion only.
        # Only use top 25% strongest motion pixels — filters out diffuse
        # background motion (particles, scrolling, UI) and isolates the
        # main character/action region.
        fh, fw = mag.shape
        mag_threshold = np.percentile(mag, 75)
        if mag_threshold > MIN_FLOW_MAG:
            strong_mask = mag >= mag_threshold
            strong_mag = np.where(strong_mask, mag, 0.0)
            x_coords = np.linspace(0.0, 1.0, fw, dtype=np.float64)
            x_grid = np.broadcast_to(x_coords, (fh, fw))
            frame_strong_sum = float(strong_mag.sum())
            if frame_strong_sum > 0:
                weighted_x_sum += float((strong_mag * x_grid).sum())
                total_mag_weight += frame_strong_sum

    # Focus point: where the character/action is horizontally (0-100%)
    focus_x = 50.0
    if total_mag_weight > 0:
        focus_x = round((weighted_x_sum / total_mag_weight) * 100, 1)
        # Clamp to 20-80% — avoid extreme edge crops
        focus_x = max(20.0, min(80.0, focus_x))

    max_mag = max(mags) if max(mags) > 0 else 1.0
    max_var = max(vars_) if max(vars_) > 0 else 1.0

    for i, frame in enumerate(frames):
        mag_norm = mags[i] / max_mag
        var_norm = vars_[i] / max_var
        ent = entropies[i]   # already [0, 1]
        cov = coverages[i]   # already [0, 1]

        # Direction entropy is the dominant signal:
        # - Fighting/explosion: high entropy (0.8+), high coverage
        # - Walking/running: low entropy (0.3-), medium coverage
        # - Menu/idle: near-zero everything
        frame.motion_score = round(
            0.20 * mag_norm
            + 0.20 * var_norm
            + 0.40 * ent
            + 0.20 * cov,
            4,
        )

    return frames, focus_x
