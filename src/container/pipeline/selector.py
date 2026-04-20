"""
Multi-pass frame selector.

Combines optical flow, CLIP visual scoring, scene detection, and spike detection
to score every extracted frame, then picks the top N with gap enforcement.

Scoring formula per frame (when CLIP available):
    cv_confidence = (
        0.40 * motion_score           # optical flow magnitude + direction entropy
      + 0.30 * clip_score             # CLIP visual excitement (edge density, saturation)
      + 0.15 * scene_proximity_score  # closeness to a scene boundary
      + 0.10 * motion_spike_score     # is this a local peak in motion?
      + 0.05 * temporal_score         # constant 0.5 for all frames (no positional bias)
    )

When CLIP is unavailable, weights redistribute proportionally:
    0.57 * motion + 0.21 * scene + 0.14 * spike + 0.08 * temporal
"""
import logging
import numpy as np

from .types import ExtractedFrame, SceneBoundary, CandidateFrame, ScoredFrame, ActionCluster
from .clip_scorer import score_frames_clip

logger = logging.getLogger(__name__)


def calculate_optimal_frame_count(duration_seconds: float) -> int:
    """Adaptive frame count — 10-15 frames/min is industry standard."""
    if duration_seconds < 10:
        return max(8, int(duration_seconds * 1.2))
    if duration_seconds < 30:
        return max(12, int(duration_seconds * 0.6))
    if duration_seconds < 60:
        return max(18, int(duration_seconds * 0.4))
    return max(24, int(duration_seconds * 0.3))


def calculate_adaptive_gap(motion_scores: list[float], base_gap: float = 1.5) -> float:
    """Smaller gap for high-action, larger for low-action videos."""
    avg = float(np.mean(motion_scores)) if motion_scores else 0.0
    if avg > 0.7:
        return base_gap * 0.4   # ~0.6s — rapid sequences
    if avg > 0.5:
        return base_gap * 0.7   # ~1.05s
    return base_gap * 1.3       # ~2.0s


def calculate_adaptive_threshold(cv_confidences: list[float], target_percentile: float = 0.35) -> float:
    """Keep top 35% of frames as action.
    Index at 35% through the descending list gives the score above which 35% of frames lie.
    Floor at 0.01 to avoid dropping all frames on truly static videos."""
    if not cv_confidences:
        return 0.35
    sorted_scores = sorted(cv_confidences, reverse=True)
    idx = int(len(sorted_scores) * target_percentile)
    return max(0.01, sorted_scores[min(idx, len(sorted_scores) - 1)])


def add_multi_scale_scores(frames: list[ExtractedFrame]) -> None:
    """Mutates frames in place: adds motion context at 0.5s/1.5s/4s windows."""
    for frame in frames:
        def window_avg(w: float) -> float:
            win = [f.motion_score for f in frames if abs(f.timestamp - frame.timestamp) <= w / 2]
            return float(np.mean(win)) if win else 0.0
        frame.multi_scale_score = round(
            0.50 * window_avg(0.5) + 0.30 * window_avg(1.5) + 0.20 * window_avg(4.0), 4
        )


def _normalize_cv_confidence(frames: list[ExtractedFrame]) -> None:
    """Rank-based normalization: assigns rank/(N-1) to each frame.

    Scores are uniformly distributed in [0, 1] regardless of the raw distribution.
    This ensures the sensitivity slider is always linear for every game genre:
      - slider at 0.65 → always shows top ~35% of frames
      - slider at 0.45 → always shows top ~55% of frames

    Min-max was insufficient for Subway Surfer / endless-runners: all frames
    genuinely have high motion relative to each other, so after min-max they still
    cluster at 0.5–0.8 and the slider does nothing below 0.7.
    """
    if not frames:
        return
    sorted_frames = sorted(frames, key=lambda f: f.cv_confidence)
    n = len(sorted_frames)
    for rank, frame in enumerate(sorted_frames):
        frame.cv_confidence = round(rank / max(n - 1, 1), 4)


def segment_based_selection(
    frames: list[ExtractedFrame], num_segments: int, frames_per_segment: int
) -> list[ExtractedFrame]:
    """Divide video into N segments, take top M by cv_confidence from each."""
    if not frames:
        return []
    duration = frames[-1].timestamp
    seg_dur = duration / num_segments if num_segments > 0 else 1.0
    selected: list[ExtractedFrame] = []
    for i in range(num_segments):
        seg = [f for f in frames if i * seg_dur <= f.timestamp < (i + 1) * seg_dur]
        seg.sort(key=lambda f: f.cv_confidence, reverse=True)
        selected.extend(seg[:frames_per_segment])
    selected.sort(key=lambda f: f.timestamp)
    return selected


def _score_all_frames(
    frames: list[ExtractedFrame],
    scene_boundaries: list[SceneBoundary],
    scene_proximity_window: float = 2.0,
) -> None:
    """Run passes 1-4: scene proximity, spike detection, temporal, combined CV confidence.
    Mutates frames in place.
    """
    if not frames:
        return

    duration = frames[-1].timestamp if frames else 0.0
    boundary_times = [b.timestamp for b in scene_boundaries]
    motion_scores = [f.motion_score for f in frames]

    # === Pass 1: Scene proximity score ===
    for frame in frames:
        if not boundary_times:
            frame.scene_proximity_score = 0.0
            continue
        min_dist = min(abs(frame.timestamp - bt) for bt in boundary_times)
        if min_dist <= scene_proximity_window:
            frame.scene_proximity_score = round(1.0 - (min_dist / scene_proximity_window), 4)
            frame.near_scene_boundary = True
            closest_b = min(scene_boundaries, key=lambda b: abs(b.timestamp - frame.timestamp))
            frame.scene_type = closest_b.scene_type if min_dist < 0.5 else 'near_cut'
        else:
            frame.scene_proximity_score = 0.0

    # === Pass 2: Local motion spike detection ===
    SPIKE_WINDOW = 2  # frames each side
    for i, frame in enumerate(frames):
        lo = max(0, i - SPIKE_WINDOW)
        hi = min(len(frames), i + SPIKE_WINDOW + 1)
        window_scores = motion_scores[lo:hi]
        local_max = max(window_scores) if window_scores else 1.0
        if local_max > 0 and frame.motion_score >= local_max * 0.9:
            frame.motion_spike_score = 1.0
        elif local_max > 0:
            frame.motion_spike_score = round(frame.motion_score / local_max, 4)
        else:
            frame.motion_spike_score = 0.5

    # === Pass 3: Temporal position score ===
    # Neutral — all positions equal. Temporal diversity is enforced in the
    # frontend selection logic (segment-based picking) instead of biasing scores.
    for frame in frames:
        frame.temporal_score = 0.5

    # === Pass 4: Visual excitement scoring (edge density, saturation, entropy) ===
    clip_available = True
    try:
        clip_scores = score_frames_clip(frames)
        for frame, cs in zip(frames, clip_scores):
            frame.clip_score = cs
    except Exception as exc:
        logger.warning("CLIP scoring failed (%s); redistributing weight to other signals", exc)
        clip_available = False
        for frame in frames:
            frame.clip_score = 0.0

    # === Pass 5: Combined CV confidence ===
    # Motion (with direction entropy) is the strongest signal at 40%.
    # Visual (with SSIM structural change) provides per-frame quality at 30%.
    # Scene proximity and spike detection are supporting signals.
    #
    # When CLIP is unavailable its 0.30 weight is redistributed proportionally
    # across the remaining signals (sum of non-CLIP weights = 0.70):
    #   motion:          0.40/0.70 ≈ 0.57
    #   scene_proximity: 0.15/0.70 ≈ 0.21
    #   motion_spike:    0.10/0.70 ≈ 0.14
    #   temporal:        0.05/0.70 ≈ 0.08
    if clip_available:
        w_motion, w_clip, w_scene, w_spike, w_temporal = 0.40, 0.30, 0.15, 0.10, 0.05
    else:
        w_motion, w_clip, w_scene, w_spike, w_temporal = 0.57, 0.00, 0.21, 0.14, 0.08

    for frame in frames:
        frame.cv_confidence = round(
            w_motion * frame.motion_score
            + w_clip * frame.clip_score
            + w_scene * frame.scene_proximity_score
            + w_spike * frame.motion_spike_score
            + w_temporal * frame.temporal_score,
            4,
        )

    # === Pass 6: Relative normalization ===
    # Makes scores discriminative regardless of genre.
    # Subway Surfer / endless-runners would otherwise bunch all frames at 0.56-0.78.
    _normalize_cv_confidence(frames)


def select_best_candidates(
    frames: list[ExtractedFrame],
    scene_boundaries: list[SceneBoundary],
    max_candidates: int = 5,
    min_gap_seconds: float = 2.0,
    scene_proximity_window: float = 2.0,
) -> list[CandidateFrame]:
    """Score all frames and select top candidates for AI analysis.

    Uses adaptive frame count, adaptive gap, multi-scale temporal scoring,
    and segment-based temporal diversity selection.
    """
    if not frames:
        return []

    _score_all_frames(frames, scene_boundaries, scene_proximity_window)
    add_multi_scale_scores(frames)

    # Re-weight cv_confidence to include multi_scale_score
    for frame in frames:
        frame.cv_confidence = round(
            0.25 * frame.motion_score
            + 0.20 * frame.multi_scale_score
            + 0.25 * frame.clip_score
            + 0.15 * frame.scene_proximity_score
            + 0.10 * frame.motion_spike_score
            + 0.05 * frame.temporal_score,
            4,
        )
    # Re-normalize after reweighting (overwrites Pass 6 from _score_all_frames)
    _normalize_cv_confidence(frames)

    # Adaptive frame count and gap based on video characteristics
    duration = frames[-1].timestamp if frames else 0.0
    motion_scores = [f.motion_score for f in frames]
    optimal_count = calculate_optimal_frame_count(duration)
    adaptive_gap = calculate_adaptive_gap(motion_scores)

    # Use caller-supplied max_candidates if it's larger than adaptive, else adaptive
    target_count = max(max_candidates, optimal_count)
    gap = min(min_gap_seconds, adaptive_gap) if min_gap_seconds < adaptive_gap else adaptive_gap

    # Try segment-based selection first for temporal diversity
    num_segments = max(2, target_count // 3)
    frames_per_seg = max(1, target_count // num_segments + 1)
    segment_result = segment_based_selection(frames, num_segments, frames_per_seg)

    # Fall back to sorted gap-based if segment_based returns < 60% of target
    if len(segment_result) < max(1, int(target_count * 0.6)):
        sorted_frames = sorted(frames, key=lambda f: f.cv_confidence, reverse=True)
        gap_selected: list[ExtractedFrame] = []
        for frame in sorted_frames:
            if len(gap_selected) >= target_count:
                break
            too_close = any(abs(frame.timestamp - s.timestamp) < gap for s in gap_selected)
            if not too_close:
                gap_selected.append(frame)
        pool = gap_selected
    else:
        # Deduplicate segment result by gap enforcement
        sorted_seg = sorted(segment_result, key=lambda f: f.cv_confidence, reverse=True)
        pool: list[ExtractedFrame] = []
        for frame in sorted_seg:
            if len(pool) >= target_count:
                break
            too_close = any(abs(frame.timestamp - s.timestamp) < gap for s in pool)
            if not too_close:
                pool.append(frame)

    # Trim to max_candidates (the hard caller-specified limit)
    pool.sort(key=lambda f: f.timestamp)
    pool = pool[:max_candidates]

    return [
        CandidateFrame(
            index=f.index,
            timestamp=f.timestamp,
            motion_score=f.motion_score,
            near_scene_boundary=f.near_scene_boundary,
            scene_type=f.scene_type,
            jpeg_base64=f.jpeg_base64,
            cv_confidence=f.cv_confidence,
        )
        for f in pool
    ]


def detect_all_actions(
    frames: list[ExtractedFrame],
    scene_boundaries: list[SceneBoundary],
    action_threshold: float = 0.35,
    cluster_gap_seconds: float = 1.5,
    scene_proximity_window: float = 2.0,
) -> tuple[list[ScoredFrame], list[ActionCluster]]:
    """
    Score all frames and classify as action/non-action.
    Clusters adjacent action frames and picks peak per cluster.

    Returns:
        (all_scored_frames, action_clusters)
    """
    if not frames:
        return [], []

    _score_all_frames(frames, scene_boundaries, scene_proximity_window)
    add_multi_scale_scores(frames)

    # Compute percentile-based adaptive threshold.
    # Use the STRICTER of: caller-supplied threshold vs. percentile.
    # This prevents Subway Surfer / endless-runners from marking every frame as action.
    # max() ensures the threshold can only go UP (top 35% cutoff), never down.
    cv_confidences = [f.cv_confidence for f in frames]
    percentile_threshold = calculate_adaptive_threshold(cv_confidences)
    effective_threshold = max(action_threshold, percentile_threshold)
    logger.info(
        "detect_all_actions: caller=%.3f percentile=%.3f effective=%.3f",
        action_threshold, percentile_threshold, effective_threshold,
    )

    # Build scored frames list (lightweight, no image data)
    all_scored: list[ScoredFrame] = []
    for f in frames:
        all_scored.append(ScoredFrame(
            index=f.index,
            timestamp=f.timestamp,
            motion_score=f.motion_score,
            scene_proximity_score=f.scene_proximity_score,
            motion_spike_score=f.motion_spike_score,
            temporal_score=f.temporal_score,
            cv_confidence=f.cv_confidence,
            clip_score=f.clip_score,
            near_scene_boundary=f.near_scene_boundary,
            scene_type=f.scene_type,
            is_action=f.cv_confidence >= effective_threshold,
        ))

    # Cluster adjacent action frames
    action_frames = [(i, f) for i, f in enumerate(frames) if all_scored[i].is_action]

    clusters: list[ActionCluster] = []

    if not action_frames:
        return all_scored, clusters

    # Group into clusters where consecutive action frames are within cluster_gap
    current_cluster: list[tuple[int, ExtractedFrame]] = [action_frames[0]]
    for j in range(1, len(action_frames)):
        _, prev_f = current_cluster[-1]
        _, curr_f = action_frames[j]
        if curr_f.timestamp - prev_f.timestamp <= cluster_gap_seconds:
            current_cluster.append(action_frames[j])
        else:
            clusters.append(_build_cluster(current_cluster))
            current_cluster = [action_frames[j]]
    clusters.append(_build_cluster(current_cluster))

    return all_scored, clusters


def _build_cluster(group: list[tuple[int, ExtractedFrame]]) -> ActionCluster:
    """Build an ActionCluster from a group of adjacent action frames."""
    peak_idx, peak_frame = max(group, key=lambda x: x[1].cv_confidence)
    return ActionCluster(
        peak_index=peak_frame.index,
        peak_timestamp=peak_frame.timestamp,
        peak_cv_confidence=peak_frame.cv_confidence,
        start_timestamp=group[0][1].timestamp,
        end_timestamp=group[-1][1].timestamp,
        frame_count=len(group),
        jpeg_base64=peak_frame.jpeg_base64,
    )
