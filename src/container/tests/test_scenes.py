"""
Tests for scene boundary detection.
Full tests require a fixture video — unit tests mock the scenedetect output.
"""
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE_VIDEO = FIXTURES / "sample.mp4"


def test_empty_video_returns_empty_list():
    """If scenedetect raises, should return empty list (not crash)."""
    from pipeline.scenes import detect_scene_boundaries
    result = detect_scene_boundaries("/nonexistent/video.mp4")
    assert result == []


def test_boundaries_sorted_by_timestamp():
    from pipeline.scenes import detect_scene_boundaries

    # Mock detect() to return two scenes out of order
    mock_scene_1 = (MagicMock(get_seconds=lambda: 5.0), MagicMock(get_seconds=lambda: 10.0))
    mock_scene_2 = (MagicMock(get_seconds=lambda: 1.0), MagicMock(get_seconds=lambda: 5.0))

    with patch('pipeline.scenes.detect', return_value=[mock_scene_1, mock_scene_2]):
        boundaries = detect_scene_boundaries("/fake/video.mp4")

    timestamps = [b.timestamp for b in boundaries]
    assert timestamps == sorted(timestamps)


def test_boundary_fields():
    from pipeline.scenes import detect_scene_boundaries

    mock_scene = (MagicMock(get_seconds=lambda: 3.5), MagicMock(get_seconds=lambda: 8.0))

    with patch('pipeline.scenes.detect', return_value=[mock_scene]):
        boundaries = detect_scene_boundaries("/fake/video.mp4")

    assert len(boundaries) == 1
    b = boundaries[0]
    assert b.timestamp == pytest.approx(3.5, abs=0.01)
    assert b.end_timestamp == pytest.approx(8.0, abs=0.01)
    assert b.duration == pytest.approx(4.5, abs=0.01)
    assert b.scene_type == 'content_change'


@pytest.mark.skipif(
    not SAMPLE_VIDEO.exists(),
    reason="Fixture video not found. Create with: ffmpeg -f lavfi -i color=c=blue:size=640x360:rate=30 -t 5 tests/fixtures/sample.mp4"
)
def test_with_fixture_video():
    from pipeline.scenes import detect_scene_boundaries
    boundaries = detect_scene_boundaries(str(SAMPLE_VIDEO))
    # A solid-color video has no scene changes
    assert isinstance(boundaries, list)
    for b in boundaries:
        assert b.timestamp >= 0
        assert b.duration > 0
