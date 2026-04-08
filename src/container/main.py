"""
vid2creative CV Container — FastAPI server.

Runs inside a Cloudflare Container alongside the main Worker.
Handles all heavy video processing: FFmpeg extraction, OpenCV optical flow,
PySceneDetect scene boundaries, and multi-pass candidate selection.

The Worker calls POST /process with a video URL and session ID.
This service returns the top candidate frames (with JPEG base64) for
AI labeling back in the Worker.
"""
import time
import tempfile
import os

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from pipeline.extract import extract_keyframes
from pipeline.motion import compute_optical_flow_scores
from pipeline.scenes import detect_scene_boundaries
from pipeline.selector import select_best_candidates, detect_all_actions
from pipeline.types import CandidateFrame, ScoredFrame, ActionCluster

app = FastAPI(title="vid2creative-cv", version="2.0.0")


class ProcessRequest(BaseModel):
    video_url: str          # R2 presigned URL or public URL of uploaded video
    session_id: str
    max_candidates: int = 5  # how many frames to return to AI
    interval: float = 1.0    # frame extraction interval in seconds


class ProcessResponse(BaseModel):
    session_id: str
    total_frames_extracted: int
    scene_boundaries_found: int
    candidates: list[CandidateFrame]
    processing_time_ms: int


class DetectActionsRequest(BaseModel):
    video_url: str
    session_id: str
    interval: float = 0.5       # denser extraction for action detection
    action_threshold: float = 0.35
    cluster_gap_seconds: float = 1.5


class DetectActionsResponse(BaseModel):
    session_id: str
    total_frames_extracted: int
    scene_boundaries_found: int
    action_count: int
    action_clusters: list[ActionCluster]
    all_scores: list[ScoredFrame]
    focus_x: float              # horizontal center of action (0-100%) for smart crop
    processing_time_ms: int


@app.get("/health")
async def health():
    return {"status": "ok", "service": "vid2creative-cv", "version": "2.0.0"}


@app.post("/process", response_model=ProcessResponse)
async def process_video(req: ProcessRequest):
    """
    Full CV pipeline:
    1. Download video from R2
    2. Extract frames with FFmpeg
    3. Compute optical flow motion scores
    4. Detect scene boundaries
    5. Cross-reference signals and select top candidates
    6. Return candidates (with JPEG base64) for AI labeling
    """
    start = time.monotonic()

    # Download video to a temp file
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(req.video_url)
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to fetch video from storage: HTTP {resp.status_code}",
            )
        video_bytes = resp.content

    # Write to named temp file (FFmpeg requires a real path)
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(video_bytes)
        video_path = tmp.name

    try:
        # Pass 1: Extract frames at interval using FFmpeg
        frames = extract_keyframes(video_path, interval=req.interval)
        if not frames:
            raise HTTPException(status_code=422, detail="No frames could be extracted from video")

        # Pass 2: Dense optical flow motion scoring
        frames, _focus_x = compute_optical_flow_scores(frames)

        # Pass 3: Scene boundary detection
        scene_boundaries = detect_scene_boundaries(video_path)

        # Pass 4: Multi-pass scoring and candidate selection
        candidates = select_best_candidates(
            frames=frames,
            scene_boundaries=scene_boundaries,
            max_candidates=req.max_candidates,
        )

        elapsed_ms = int((time.monotonic() - start) * 1000)

        return ProcessResponse(
            session_id=req.session_id,
            total_frames_extracted=len(frames),
            scene_boundaries_found=len(scene_boundaries),
            candidates=candidates,
            processing_time_ms=elapsed_ms,
        )

    finally:
        # Always clean up — never leak video data on disk (Invariant I17)
        try:
            os.unlink(video_path)
        except OSError:
            pass


@app.post("/detect-actions", response_model=DetectActionsResponse)
async def detect_actions(req: DetectActionsRequest):
    """
    ML action detection pipeline (no AI neurons):
    1. Download video from R2
    2. Extract frames at dense interval
    3. Compute optical flow motion scores
    4. Detect scene boundaries
    5. Score all frames and cluster action moments
    6. Return all scores + action clusters with thumbnails
    """
    start = time.monotonic()

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(req.video_url)
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to fetch video from storage: HTTP {resp.status_code}",
            )
        video_bytes = resp.content

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(video_bytes)
        video_path = tmp.name

    try:
        frames = extract_keyframes(video_path, interval=req.interval)
        if not frames:
            raise HTTPException(status_code=422, detail="No frames could be extracted from video")

        frames, focus_x = compute_optical_flow_scores(frames)
        scene_boundaries = detect_scene_boundaries(video_path)

        all_scores, action_clusters = detect_all_actions(
            frames=frames,
            scene_boundaries=scene_boundaries,
            action_threshold=req.action_threshold,
            cluster_gap_seconds=req.cluster_gap_seconds,
        )

        elapsed_ms = int((time.monotonic() - start) * 1000)

        return DetectActionsResponse(
            session_id=req.session_id,
            total_frames_extracted=len(frames),
            scene_boundaries_found=len(scene_boundaries),
            action_count=len(action_clusters),
            action_clusters=action_clusters,
            all_scores=all_scores,
            focus_x=focus_x,
            processing_time_ms=elapsed_ms,
        )

    finally:
        try:
            os.unlink(video_path)
        except OSError:
            pass
