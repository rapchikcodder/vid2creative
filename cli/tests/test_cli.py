"""
CLI command tests using typer.testing.CliRunner.
All API calls are mocked — no real server required.
"""
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from typer.testing import CliRunner

from vid2creative.cli import app

runner = CliRunner()

# --- helpers ---

FAKE_SESSION = {"sessionId": "test-session-abc", "videoUrl": "https://r2.example.com/test.mp4"}

FAKE_PROCESS_RESULT = {
    "sessionId": "test-session-abc",
    "totalFramesExtracted": 20,
    "sceneBoundaries": 3,
    "cvProcessingTimeMs": 1500,
    "aiProcessingTimeMs": 800,
    "processingTimeMs": 2300,
    "candidates": [
        {
            "index": 5, "timestamp": 5.0, "motion_score": 0.8,
            "cv_confidence": 0.75, "nearSceneBoundary": True,
            "scene_type": "content_change", "isAction": True,
            "actionLabel": "Heavy Strike!", "importance": 9,
            "cta": {"text": "Fight Now", "style": "pulse", "size": "large",
                    "position": {"x": 50, "y": 80}, "visible": True, "action": "link"},
            "animationSuggestion": "shake",
        },
    ],
    "timeline": [
        {
            "id": "abc12345", "frameIndex": 5, "timestamp": 2.5, "duration": 0.6,
            "cta": {"text": "Fight Now", "style": "pulse", "size": "large",
                    "position": {"x": 50, "y": 80}, "visible": True, "action": "link"},
            "overlay": {"type": "none", "text": "", "position": "top-right", "visible": False},
            "animation": "shake", "pauseVideo": True,
        }
    ],
}

FAKE_HTML = "<!DOCTYPE html><html><body>test creative</body></html>"

FAKE_HEALTH = {"status": "ok", "version": "2.0.0", "container": "ok"}


def make_temp_video():
    """Create a tiny temp file simulating a video."""
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.write(b"\x00" * 1024)  # 1KB fake video
    tmp.close()
    return Path(tmp.name)


# --- process command ---

def test_process_success():
    video = make_temp_video()
    output = Path(tempfile.mktemp(suffix=".html"))

    with patch("vid2creative.cli.Vid2CreativeClient") as MockClient:
        client_inst = MagicMock()
        client_inst.upload.return_value = FAKE_SESSION
        client_inst.process.return_value = FAKE_PROCESS_RESULT
        client_inst.export.return_value = FAKE_HTML
        client_inst.__enter__ = lambda s: client_inst
        client_inst.__exit__ = MagicMock(return_value=False)
        MockClient.return_value = client_inst

        result = runner.invoke(app, ["process", str(video), "--output", str(output)])

    assert result.exit_code == 0, result.output
    assert output.exists()
    assert output.read_text() == FAKE_HTML

    video.unlink(missing_ok=True)
    output.unlink(missing_ok=True)


def test_process_wrong_extension():
    with tempfile.NamedTemporaryFile(suffix=".avi", delete=False) as f:
        f.write(b"\x00")
        wrong_path = Path(f.name)

    result = runner.invoke(app, ["process", str(wrong_path)])
    assert result.exit_code == 1

    wrong_path.unlink(missing_ok=True)


def test_process_file_not_found():
    result = runner.invoke(app, ["process", "/nonexistent/video.mp4"])
    assert result.exit_code != 0


# --- analyze command ---

def test_analyze_table_output():
    video = make_temp_video()

    with patch("vid2creative.cli.Vid2CreativeClient") as MockClient:
        client_inst = MagicMock()
        client_inst.upload.return_value = FAKE_SESSION
        client_inst.process.return_value = FAKE_PROCESS_RESULT
        client_inst.__enter__ = lambda s: client_inst
        client_inst.__exit__ = MagicMock(return_value=False)
        MockClient.return_value = client_inst

        result = runner.invoke(app, ["analyze", str(video)])

    assert result.exit_code == 0
    assert "Heavy Strike!" in result.output or "Detected" in result.output

    video.unlink(missing_ok=True)


def test_analyze_json_output():
    video = make_temp_video()

    with patch("vid2creative.cli.Vid2CreativeClient") as MockClient:
        client_inst = MagicMock()
        client_inst.upload.return_value = FAKE_SESSION
        result_data = dict(FAKE_PROCESS_RESULT)
        result_data["candidates"] = [dict(c) for c in FAKE_PROCESS_RESULT["candidates"]]
        client_inst.process.return_value = result_data
        client_inst.__enter__ = lambda s: client_inst
        client_inst.__exit__ = MagicMock(return_value=False)
        MockClient.return_value = client_inst

        result = runner.invoke(app, ["analyze", str(video), "--format", "json"])

    assert result.exit_code == 0

    video.unlink(missing_ok=True)


# --- status command ---

def test_status_healthy():
    with patch("vid2creative.cli.Vid2CreativeClient") as MockClient:
        client_inst = MagicMock()
        client_inst.health.return_value = FAKE_HEALTH
        client_inst.__enter__ = lambda s: client_inst
        client_inst.__exit__ = MagicMock(return_value=False)
        MockClient.return_value = client_inst

        result = runner.invoke(app, ["status"])

    assert result.exit_code == 0
    assert "ok" in result.output.lower()


def test_status_unreachable():
    with patch("vid2creative.cli.Vid2CreativeClient") as MockClient:
        client_inst = MagicMock()
        client_inst.health.side_effect = Exception("Connection refused")
        client_inst.__enter__ = lambda s: client_inst
        client_inst.__exit__ = MagicMock(return_value=False)
        MockClient.return_value = client_inst

        result = runner.invoke(app, ["status"])

    assert result.exit_code == 1
