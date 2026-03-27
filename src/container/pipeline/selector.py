"""
Multi-pass frame selector.

Combines optical flow, scene detection, and temporal position to score
every extracted frame, then picks the top N with gap enforcement.

Scoring formula per frame:
    cv_confidence = (
        0.35 * motion_score           # optical flow magnitude + variance
      + 0.25 * scene_proximity_score  # closeness to a scene boundary
      + 0.25 * motion_spike_score     # is this a local peak in motion?
      + 0.15 * temporal_score         # prefer mid-video over start/end
    )

Replaces from v1.2.0:
    - selectHighMotionFrames() (segment-based)
    - selectBestActions() (AI-gated with fallback)
    - The motion_score fallback logic
"""
from .types import ExtractedFrame, SceneBoundary, CandidateFrame


def select_best_candidates(
    frames: list[ExtractedFrame],
    scene_boundaries: list[SceneBoundary],
    max_candidates: int = 5,
    min_gap_seconds: float = 2.0,
    scene_proximity_window: float = 2.0,
) -> list[CandidateFrame]:
    """
    Score all frames and select top candidates for AI analysis.

    Args:
        frames: Frames with motion_score populated (from motion.py)
        scene_boundaries: Scene cuts (from scenes.py)
        max_candidates: How many frames to return
        min_gap_seconds: Minimum seconds between selected candidates
        scene_proximity_window: Seconds around a scene cut that counts as "near"

    Returns:
        Top-N candidates sorted by timestamp
    """
    if not frames:
        return []

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
            # Find the boundary this frame is closest to
            closest_b = min(scene_boundaries, key=lambda b: abs(b.timestamp - frame.timestamp))
            frame.scene_type = closest_b.scene_type if min_dist < 0.5 else 'near_cut'
        else:
            frame.scene_proximity_score = 0.0

    # === Pass 2: Local motion spike detection ===
    # A frame is a spike if it's ≥ 90% of its local neighborhood maximum
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
    # Slightly prefer the middle 60-80% of the video
    for frame in frames:
        if duration <= 0:
            frame.temporal_score = 0.5
            continue
        t = frame.timestamp / duration  # 0.0 to 1.0
        if 0.15 <= t <= 0.85:
            frame.temporal_score = 1.0
        elif t < 0.15:
            frame.temporal_score = round(t / 0.15, 4)          # ramp 0→1 over first 15%
        else:
            frame.temporal_score = round((1.0 - t) / 0.15, 4)  # ramp 1→0 over last 15%

    # === Pass 4: Combined CV confidence ===
    for frame in frames:
        frame.cv_confidence = round(
            0.35 * frame.motion_score
            + 0.25 * frame.scene_proximity_score
            + 0.25 * frame.motion_spike_score
            + 0.15 * frame.temporal_score,
            4,
        )

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

    # Return in chronological order for timeline building
    selected.sort(key=lambda c: c.timestamp)
    return selected
