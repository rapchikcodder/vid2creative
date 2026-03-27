"""
FFmpeg-based frame extraction.

Two modes:
1. Interval mode: Extract every N seconds (like the old canvas approach, but reliable)
2. Keyframe timestamps: I-frames from the codec (bonus candidates — often align with scene cuts)

Always use interval mode as the base, with keyframe timestamps available
as extra context for the selector.
"""
import ffmpeg
import cv2
import numpy as np
import base64
import tempfile
import os
import subprocess
import json
from .types import ExtractedFrame


def get_video_info(video_path: str) -> dict:
    """Get video duration, fps, resolution using ffprobe."""
    probe = ffmpeg.probe(video_path)
    video_stream = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    fps_str = video_stream['r_frame_rate']  # e.g. "30/1"
    num, den = fps_str.split('/')
    fps = float(num) / float(den)
    return {
        'duration': float(probe['format']['duration']),
        'fps': fps,
        'width': int(video_stream['width']),
        'height': int(video_stream['height']),
        'codec': video_stream['codec_name'],
    }


def extract_keyframes(video_path: str, interval: float = 1.0, width: int = 640) -> list[ExtractedFrame]:
    """
    Extract frames at regular intervals using FFmpeg.

    Args:
        video_path: Path to video file
        interval: Seconds between frames (default 1.0)
        width: Output frame width (height auto-scaled to preserve aspect ratio)

    Returns:
        List of ExtractedFrame with index, timestamp, numpy array, and JPEG base64
    """
    info = get_video_info(video_path)
    aspect = info['height'] / info['width']
    out_height = int(width * aspect)
    # Ensure even dimensions (required by many codecs)
    if out_height % 2 != 0:
        out_height += 1

    frames: list[ExtractedFrame] = []

    with tempfile.TemporaryDirectory() as tmpdir:
        output_pattern = os.path.join(tmpdir, "frame_%04d.jpg")
        (
            ffmpeg
            .input(video_path)
            .filter('fps', fps=1.0 / interval)
            .filter('scale', width, out_height)
            .output(output_pattern, qscale=2)  # qscale=2 = high quality JPEG
            .overwrite_output()
            .run(quiet=True)
        )

        frame_files = sorted([
            f for f in os.listdir(tmpdir) if f.startswith("frame_") and f.endswith(".jpg")
        ])

        for i, fname in enumerate(frame_files):
            fpath = os.path.join(tmpdir, fname)
            img = cv2.imread(fpath)
            if img is None:
                continue

            with open(fpath, 'rb') as f:
                jpeg_bytes = f.read()

            frames.append(ExtractedFrame(
                index=i,
                timestamp=round(i * interval, 2),
                image=img,
                jpeg_base64=base64.b64encode(jpeg_bytes).decode('ascii'),
                motion_score=0.0,
                near_scene_boundary=False,
                scene_type='none',
                cv_confidence=0.0,
            ))

    return frames


def get_keyframe_timestamps(video_path: str) -> list[float]:
    """
    Extract I-frame (keyframe) timestamps using ffprobe.
    These are frames where the codec detected a significant change.
    Useful as bonus candidates — they often align with scene cuts.
    """
    cmd = [
        'ffprobe', '-v', 'quiet',
        '-select_streams', 'v:0',
        '-show_entries', 'frame=pts_time,pict_type',
        '-of', 'json',
        video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []

    keyframe_times = []
    for frame in data.get('frames', []):
        if frame.get('pict_type') == 'I' and 'pts_time' in frame:
            keyframe_times.append(float(frame['pts_time']))

    return sorted(keyframe_times)
