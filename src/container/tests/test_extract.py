"""
Tests for FFmpeg frame extraction.

Requires: a 5-second fixture video at tests/fixtures/sample.mp4
Create it with: ffmpeg -f lavfi -i color=c=blue:size=640x360:rate=30 -t 5 tests/fixtures/sample.mp4
"""
import os
import pytest
import base64
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE_VIDEO = FIXTURES / "sample.mp4"


def skip_if_no_fixture():
    return pytest.mark.skipif(
        not SAMPLE_VIDEO.exists(),
        reason="Fixture video not found. Create with: ffmpeg -f lavfi -i color=c=blue:size=640x360:rate=30 -t 5 tests/fixtures/sample.mp4"
    )


@skip_if_no_fixture()
def test_get_video_info():
    from pipeline.extract import get_video_info
    info = get_video_info(str(SAMPLE_VIDEO))
    assert info['duration'] == pytest.approx(5.0, abs=0.5)
    assert info['width'] == 640
    assert info['height'] == 360
    assert info['fps'] == pytest.approx(30.0, abs=1.0)


@skip_if_no_fixture()
def test_extract_keyframes_count():
    from pipeline.extract import extract_keyframes
    frames = extract_keyframes(str(SAMPLE_VIDEO), interval=1.0)
    # 5-second video at 1s interval → ~5 frames
    assert 4 <= len(frames) <= 6


@skip_if_no_fixture()
def test_extract_keyframes_interval_0_5():
    from pipeline.extract import extract_keyframes
    frames = extract_keyframes(str(SAMPLE_VIDEO), interval=0.5)
    # 5-second video at 0.5s interval → ~10 frames
    assert 8 <= len(frames) <= 12


@skip_if_no_fixture()
def test_frame_has_valid_jpeg():
    from pipeline.extract import extract_keyframes
    frames = extract_keyframes(str(SAMPLE_VIDEO), interval=1.0)
    assert len(frames) > 0

    f = frames[0]
    # Check base64 decodes to valid JPEG (starts with JPEG magic bytes FFD8)
    raw = base64.b64decode(f.jpeg_base64)
    assert raw[:2] == b'\xff\xd8', "Not a valid JPEG"


@skip_if_no_fixture()
def test_frame_has_nonzero_image():
    from pipeline.extract import extract_keyframes
    frames = extract_keyframes(str(SAMPLE_VIDEO), interval=1.0)
    f = frames[0]
    assert f.image is not None
    assert f.image.shape[0] > 0   # height
    assert f.image.shape[1] > 0   # width
    assert f.image.shape[2] == 3  # BGR channels


@skip_if_no_fixture()
def test_frame_timestamps_ascending():
    from pipeline.extract import extract_keyframes
    frames = extract_keyframes(str(SAMPLE_VIDEO), interval=1.0)
    timestamps = [f.timestamp for f in frames]
    assert timestamps == sorted(timestamps)


@skip_if_no_fixture()
def test_get_keyframe_timestamps():
    from pipeline.extract import get_keyframe_timestamps
    times = get_keyframe_timestamps(str(SAMPLE_VIDEO))
    # Should be sorted floats
    assert isinstance(times, list)
    if len(times) > 1:
        assert times == sorted(times)
    for t in times:
        assert isinstance(t, float)
        assert 0.0 <= t <= 10.0
