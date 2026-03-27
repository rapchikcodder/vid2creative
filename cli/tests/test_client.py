"""
API client tests using httpx mock transport.
"""
import tempfile
from pathlib import Path
import pytest
import httpx

from vid2creative.client import Vid2CreativeClient


def make_mock_transport(responses: dict) -> httpx.MockTransport:
    """Build an httpx mock transport from a {method_url: Response} dict."""
    def handler(request: httpx.Request) -> httpx.Response:
        key = f"{request.method} {request.url}"
        for pattern, resp in responses.items():
            if pattern in key:
                return resp
        return httpx.Response(404, json={"error": "Not found in mock"})
    return httpx.MockTransport(handler)


def make_client(responses: dict) -> Vid2CreativeClient:
    client = Vid2CreativeClient("https://api.example.com")
    client._client = httpx.Client(transport=make_mock_transport(responses))
    return client


def test_health():
    client = make_client({
        "GET https://api.example.com/api/health": httpx.Response(200, json={"status": "ok", "version": "2.0.0"})
    })
    result = client.health()
    assert result["status"] == "ok"
    assert result["version"] == "2.0.0"


def test_upload():
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        f.write(b"\x00" * 512)
        video_path = Path(f.name)

    client = make_client({
        "POST https://api.example.com/api/upload": httpx.Response(
            200, json={"sessionId": "abc123", "videoUrl": "https://r2/test.mp4", "status": "ready"}
        )
    })

    result = client.upload(video_path)
    assert result["sessionId"] == "abc123"
    video_path.unlink(missing_ok=True)


def test_process():
    client = make_client({
        "POST https://api.example.com/api/process": httpx.Response(200, json={
            "sessionId": "abc123",
            "totalFramesExtracted": 15,
            "sceneBoundaries": 2,
            "candidates": [],
            "timeline": [],
            "processingTimeMs": 2000,
            "cvProcessingTimeMs": 1200,
            "aiProcessingTimeMs": 800,
        })
    })
    result = client.process("abc123", max_candidates=4)
    assert result["sessionId"] == "abc123"
    assert result["totalFramesExtracted"] == 15


def test_export():
    html_content = "<!DOCTYPE html><html><body>creative</body></html>"
    client = make_client({
        "POST https://api.example.com/api/export": httpx.Response(
            200, text=html_content, headers={"content-type": "text/html"}
        )
    })
    result = client.export("abc123", config={"width": 360, "height": 640, "timeline": []})
    assert result == html_content


def test_http_error_raises():
    client = make_client({
        "GET https://api.example.com/api/health": httpx.Response(503, json={"error": "overloaded"})
    })
    with pytest.raises(httpx.HTTPStatusError):
        client.health()


def test_context_manager():
    """Client works as a context manager."""
    with Vid2CreativeClient("https://api.example.com") as client:
        assert client._client is not None
