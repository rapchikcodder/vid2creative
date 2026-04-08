"""
Lightweight visual excitement scorer — pure OpenCV, no ML model.

Per-frame features:
  1. Edge density — action scenes have more edges (weapons, particles, HUD)
  2. Color saturation — explosions/abilities have vivid colors vs dull menus
  3. Histogram entropy — complex scenes have more diverse pixel distribution
  4. Brightness variance — action has dynamic lighting (flashes, dark-to-bright)

Cross-frame feature (key addition):
  5. Structural change — SSIM-based difference from previous frame.
     Action has rapid structural changes (new objects appear, layouts shift).
     Walking has smooth, gradual changes (same scene structure, slight position shift).
     This is the strongest PER-FRAME temporal signal alongside optical flow.

Runs ~3ms per frame on CPU. No model downloads, no OOM.
"""
import cv2
import numpy as np
from .types import ExtractedFrame


def _edge_density(gray: np.ndarray) -> float:
    """Fraction of pixels that are edges (Canny). High = complex scene."""
    edges = cv2.Canny(gray, 50, 150)
    return float(np.count_nonzero(edges)) / edges.size


def _color_saturation(bgr: np.ndarray) -> float:
    """Mean saturation in HSV. High = vivid colors (action effects, explosions)."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    return float(hsv[:, :, 1].mean()) / 255.0


def _histogram_entropy(gray: np.ndarray) -> float:
    """Normalized Shannon entropy of grayscale histogram. High = diverse scene."""
    hist = cv2.calcHist([gray], [0], None, [64], [0, 256]).flatten()
    hist = hist / (hist.sum() + 1e-10)
    hist = hist[hist > 0]
    entropy = -np.sum(hist * np.log2(hist))
    return float(entropy / 6.0)


def _brightness_variance(gray: np.ndarray) -> float:
    """Block-wise brightness variance. High = dynamic lighting (flashes, contrast)."""
    h, w = gray.shape
    bh, bw = max(1, h // 4), max(1, w // 4)
    block_means = []
    for y in range(0, h - bh + 1, bh):
        for x in range(0, w - bw + 1, bw):
            block_means.append(gray[y:y+bh, x:x+bw].mean())
    if not block_means:
        return 0.0
    arr = np.array(block_means)
    return float(np.clip(arr.std() / 80.0, 0.0, 1.0))


def _structural_change(prev_gray: np.ndarray | None, curr_gray: np.ndarray) -> float:
    """
    1 - SSIM between consecutive frames. High = rapid structural change (action).
    Low = smooth transition (walking, static).
    """
    if prev_gray is None:
        return 0.0

    # Compute SSIM using OpenCV's matchTemplate as approximation
    # Full SSIM: compare local means, variances, covariances
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2

    mu1 = cv2.GaussianBlur(prev_gray.astype(np.float64), (11, 11), 1.5)
    mu2 = cv2.GaussianBlur(curr_gray.astype(np.float64), (11, 11), 1.5)

    mu1_sq = mu1 * mu1
    mu2_sq = mu2 * mu2
    mu1_mu2 = mu1 * mu2

    sigma1_sq = cv2.GaussianBlur(prev_gray.astype(np.float64) ** 2, (11, 11), 1.5) - mu1_sq
    sigma2_sq = cv2.GaussianBlur(curr_gray.astype(np.float64) ** 2, (11, 11), 1.5) - mu2_sq
    sigma12 = cv2.GaussianBlur(
        prev_gray.astype(np.float64) * curr_gray.astype(np.float64), (11, 11), 1.5
    ) - mu1_mu2

    ssim_map = ((2 * mu1_mu2 + c1) * (2 * sigma12 + c2)) / (
        (mu1_sq + mu2_sq + c1) * (sigma1_sq + sigma2_sq + c2)
    )

    ssim_val = float(ssim_map.mean())
    # Invert: 1 - SSIM so high = more change
    return float(np.clip(1.0 - ssim_val, 0.0, 1.0))


def score_frames_clip(frames: list[ExtractedFrame]) -> list[float]:
    """
    Score each frame's visual excitement using CV features + structural change.

    Returns a list of floats in [0, 1] where:
      1.0 = visually complex/exciting with rapid changes (action)
      0.0 = visually simple/static with slow changes (menu/idle)
    """
    if not frames:
        return []

    scores: list[float] = []
    prev_gray: np.ndarray | None = None

    for f in frames:
        img = f.image
        small = cv2.resize(img, (160, 90))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        edge = _edge_density(gray)
        sat = _color_saturation(small)
        entropy = _histogram_entropy(gray)
        bright_var = _brightness_variance(gray)
        struct_change = _structural_change(prev_gray, gray)
        prev_gray = gray

        # Weighted combination:
        # - Structural change is the strongest temporal signal per-frame
        # - Edge density and saturation capture visual complexity
        # - Entropy and brightness variance are supporting signals
        combined = (
            0.35 * struct_change
            + 0.20 * edge
            + 0.20 * sat
            + 0.15 * entropy
            + 0.10 * bright_var
        )
        scores.append(round(float(np.clip(combined, 0.0, 1.0)), 4))

    return scores
