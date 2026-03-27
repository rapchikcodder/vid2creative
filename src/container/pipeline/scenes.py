"""
Scene boundary detection using PySceneDetect ContentDetector.

Detects hard cuts and content-based changes (significant visual shift
within a continuous shot). Scene boundaries matter because action moments
often occur RIGHT AFTER a cut — the editor cut TO the action.
"""
from scenedetect import detect, ContentDetector
from .types import SceneBoundary


def detect_scene_boundaries(
    video_path: str,
    content_threshold: float = 27.0,
    min_scene_len_sec: float = 0.5,
) -> list[SceneBoundary]:
    """
    Detect scene boundaries in a video.

    Args:
        video_path: Path to video file
        content_threshold: Sensitivity — lower = more scenes detected (default 27.0)
        min_scene_len_sec: Minimum scene length in seconds to avoid noise

    Returns:
        List of SceneBoundary sorted by timestamp
    """
    # Assume ~30fps for min_scene_len frame count
    min_scene_frames = max(1, int(min_scene_len_sec * 30))

    try:
        scene_list = detect(
            video_path,
            ContentDetector(
                threshold=content_threshold,
                min_scene_len=min_scene_frames,
            ),
        )
    except Exception:
        # If detection fails (e.g. codec issue), return empty list
        return []

    boundaries: list[SceneBoundary] = []
    for scene in scene_list:
        start_time = scene[0].get_seconds()
        end_time = scene[1].get_seconds()
        duration = round(end_time - start_time, 2)

        boundaries.append(SceneBoundary(
            timestamp=round(start_time, 3),
            end_timestamp=round(end_time, 3),
            duration=duration,
            scene_type='content_change',
        ))

    return sorted(boundaries, key=lambda b: b.timestamp)
