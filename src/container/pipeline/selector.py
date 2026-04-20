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

from .types import ExtractedFrame, SceneBoundary, CandidateFrame, ScoredFrame, ActionCluster
from .clip_scorer import score_frames_clip

logger = logging.getLogger(__name__)


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


def select_best_candidates(
    frames: list[ExtractedFrame],
    scene_boundaries: list[SceneBoundary],
    max_candidates: int = 5,
    min_gap_seconds: float = 2.0,
    scene_proximity_window: float = 2.0,
) -> list[CandidateFrame]:
    """Score all frames and select top candidates for AI analysis."""
    if not frames:
        return []

    _score_all_frames(frames, scene_boundaries, scene_proximity_window)

    # === Pass 5: Select top-N with gap enforcement ===
    sorted_frames = sorted(frames, key=lambda f: f.cv_confidence, reverse=True)
    selected: list[CandidateFrame] = []

    for frame in sorted_frames:
        if len(selected) >= max_candidates:
            break
        too_close = any(
            abs(frame.timestamp - s.timestamp) < min_gap_seconds
            for s in selected
        )
        if too_close:
            continue
        selected.append(CandidateFrame(
            index=frame.index,
            timestamp=frame.timestamp,
            motion_score=frame.motion_score,
            near_scene_boundary=frame.near_scene_boundary,
            scene_type=frame.scene_type,
            jpeg_base64=frame.jpeg_base64,
            cv_confidence=frame.cv_confidence,
        ))

    selected.sort(key=lambda c: c.timestamp)
    return selected


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
            is_action=f.cv_confidence >= action_threshold,
        ))

    # Cluster adjacent action frames
    action_frames = [(i, f) for i, f in enumerate(frames) if all_scored[i].is_action]

    # Adaptive threshold fallback: guarantee at least MIN_FALLBACK selected frames.
    # This handles uniform-scoring videos (e.g. side-scrollers) where the fixed
    # threshold captures nothing — we fall back to top-N by percentile rank.
    MIN_FALLBACK = 3
    if len(action_frames) < MIN_FALLBACK and len(frames) >= MIN_FALLBACK:
        sorted_scores = sorted((s.cv_confidence for s in all_scored), reverse=True)
        adaptive_threshold = sorted_scores[MIN_FALLBACK - 1]  # score of N-th best frame
        if adaptive_threshold < action_threshold:
            logger.info(
                "Adaptive threshold: fixed=%.3f captured %d/%d frames; "
                "falling back to top-%d threshold=%.3f",
                action_threshold, len(action_frames), len(frames),
                MIN_FALLBACK, adaptive_threshold,
            )
            for scored in all_scored:
                scored.is_action = scored.cv_confidence >= adaptive_threshold
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
