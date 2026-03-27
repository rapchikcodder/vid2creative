"""
HTTP client for the vid2creative Worker API.
All methods are synchronous (httpx sync client) for simplicity in CLI context.
"""
from pathlib import Path
import httpx


class Vid2CreativeClient:
    def __init__(self, base_url: str, timeout: float = 120.0):
        self.base_url = base_url.rstrip('/')
        self._client = httpx.Client(timeout=timeout)

    def health(self) -> dict:
        r = self._client.get(f"{self.base_url}/api/health")
        r.raise_for_status()
        return r.json()

    def upload(self, video_path: Path) -> dict:
        """Upload a video file. Returns { sessionId, videoUrl, status }."""
        with open(video_path, 'rb') as f:
            r = self._client.post(
                f"{self.base_url}/api/upload",
                files={"video": (video_path.name, f, "video/mp4")},
            )
        r.raise_for_status()
        return r.json()

    def process(
        self,
        session_id: str,
        max_candidates: int = 5,
        interval: float = 1.0,
    ) -> dict:
        """
        Run the full CV + AI pipeline.
        Returns ProcessResponse with candidates and timeline events.
        """
        r = self._client.post(
            f"{self.base_url}/api/process",
            json={
                "sessionId": session_id,
                "maxCandidates": max_candidates,
                "interval": interval,
            },
        )
        r.raise_for_status()
        return r.json()

    def export(self, session_id: str, config: dict) -> str:
        """Generate and return the HTML creative as a string."""
        r = self._client.post(
            f"{self.base_url}/api/export",
            json={"sessionId": session_id, "config": config},
        )
        r.raise_for_status()
        return r.text

    def close(self) -> None:
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
