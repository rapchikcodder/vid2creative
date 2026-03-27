# Claude Code Prompt: vid2creative v2.0 — Python CV Container Migration

## Context

You are upgrading the `vid2creative` platform from v1.2.0 to v2.0. The project converts gameplay videos into interactive HTML5 ad creatives (playable ads). 

**Current state (v1.2.0):** TypeScript Worker + React SPA. Frame extraction and motion detection happen client-side in the browser using canvas hacks (64×64 pixel diff). 10 candidate frames are sent to Workers AI (Llama 3.2 11B Vision) for scene classification. The frontend is a 4-step wizard (Upload → Extract → Edit → Export).

**Target state (v2.0):** The frontend is replaced with a **Python CLI tool**. All video processing moves to a **Cloudflare Container** running Python with FFmpeg, OpenCV, and PySceneDetect. The Worker stays as a thin API router. The Container runs a multi-pass CV pipeline that is far more accurate than the browser pixel-diff approach. Workers AI is still used but only for the final 3-5 frames that survive CV filtering.

**What stays the same:**
- Worker API routes (Hono, same structure)
- R2 for video/frame storage
- KV for sessions + neuron tracking
- Workers AI model (`@cf/meta/llama-3.2-11b-vision-instruct`)
- The exported HTML creative format (§10 of the existing SRS — `html-generator.ts` stays TypeScript in the Worker)
- `wrangler.toml` base config (add Container binding)

**What changes:**
- Frontend (React SPA) → removed entirely, replaced by Python CLI
- Browser frame extraction (canvas seek) → FFmpeg in Container
- Browser motion detection (64×64 pixel diff) → OpenCV optical flow in Container
- No scene detection → PySceneDetect ContentDetector in Container
- AI analyzes 10 frames → AI analyzes only 3-5 frames that survive CV filtering
- New Container service handles all video processing
- Worker gets a new route `POST /api/process` that dispatches to Container
- New CLI tool `vid2creative` built with Typer + Rich + httpx

---

## Task 1: Create the Cloudflare Container (Python CV Pipeline)

### 1.1 Container Setup

Create a new directory `src/container/` with the following structure:

```
src/container/
├── Dockerfile
├── requirements.txt
├── main.py              # FastAPI server (runs inside container)
├── pipeline/
│   ├── __init__.py
│   ├── extract.py       # FFmpeg frame extraction
│   ├── motion.py        # OpenCV optical flow motion scoring
│   ├── scenes.py        # PySceneDetect scene boundary detection
│   ├── selector.py      # Multi-pass frame selection logic
│   └── types.py         # Pydantic models for pipeline data
└── tests/
    ├── test_extract.py
    ├── test_motion.py
    ├── test_scenes.py
    └── test_selector.py
```

### 1.2 Dockerfile

```dockerfile
FROM python:3.12-slim

# Install FFmpeg and OpenCV system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### 1.3 requirements.txt

```
fastapi==0.115.*
uvicorn[standard]==0.34.*
opencv-python-headless==4.10.*
scenedetect[opencv-headless]==0.6.*
ffmpeg-python==0.2.*
numpy>=1.26,<2.0
pydantic>=2.0,<3.0
httpx>=0.27,<1.0
Pillow>=10.0,<11.0
```

### 1.4 Container FastAPI Server (`main.py`)

The container exposes a single processing endpoint:

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pipeline.extract import extract_keyframes
from pipeline.motion import compute_optical_flow_scores
from pipeline.scenes import detect_scene_boundaries
from pipeline.selector import select_best_candidates
import base64, tempfile, os, httpx

app = FastAPI(title="vid2creative-cv", version="2.0.0")

class ProcessRequest(BaseModel):
    video_url: str          # R2 URL of uploaded video
    session_id: str
    max_candidates: int = 5  # how many frames to send to AI
    interval: float = 1.0    # base extraction interval in seconds
    worker_url: str          # base URL of the Worker API (for AI calls)

class CandidateFrame(BaseModel):
    index: int
    timestamp: float
    motion_score: float       # 0.0-1.0, from optical flow
    scene_boundary: bool      # True if near a scene cut
    scene_type: str           # 'cut', 'fade', 'motion_peak', 'none'
    jpeg_base64: str          # base64 JPEG for AI analysis
    cv_confidence: float      # combined CV confidence 0.0-1.0

class ProcessResponse(BaseModel):
    session_id: str
    total_frames_extracted: int
    scene_boundaries_found: int
    candidates: list[CandidateFrame]
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
    import time
    start = time.monotonic()

    # Download video to temp file
    async with httpx.AsyncClient() as client:
        resp = await client.get(req.video_url)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Failed to fetch video: {resp.status_code}")

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(resp.content)
        video_path = tmp.name

    try:
        # Pass 1: Extract frames
        frames = extract_keyframes(video_path, interval=req.interval)

        # Pass 2: Optical flow motion scoring
        frames = compute_optical_flow_scores(frames)

        # Pass 3: Scene boundary detection
        scene_boundaries = detect_scene_boundaries(video_path)
        
        # Pass 4: Cross-reference and select
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
            candidates=[
                CandidateFrame(
                    index=c.index,
                    timestamp=c.timestamp,
                    motion_score=c.motion_score,
                    scene_boundary=c.near_scene_boundary,
                    scene_type=c.scene_type,
                    jpeg_base64=c.jpeg_base64,
                    cv_confidence=c.cv_confidence,
                )
                for c in candidates
            ],
            processing_time_ms=elapsed_ms,
        )
    finally:
        os.unlink(video_path)
```

### 1.5 Frame Extraction (`pipeline/extract.py`)

Use FFmpeg to extract frames properly — not browser seek-guessing.

```python
"""
FFmpeg-based frame extraction.

Two modes:
1. Interval mode: Extract every N seconds (like the old canvas approach, but reliable)
2. Keyframe mode: Extract only I-frames (actual scene-change keyframes from the codec)

Always use interval mode as the base, with keyframe timestamps merged in
as bonus candidates (they often align with cuts/transitions).
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
    return {
        'duration': float(probe['format']['duration']),
        'fps': eval(video_stream['r_frame_rate']),  # e.g. "30/1" → 30.0
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
    duration = info['duration']
    aspect = info['height'] / info['width']
    out_height = int(width * aspect)
    # Ensure even dimensions (required by many codecs)
    out_height = out_height if out_height % 2 == 0 else out_height + 1

    frames: list[ExtractedFrame] = []

    with tempfile.TemporaryDirectory() as tmpdir:
        # Extract frames using FFmpeg fps filter
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

        # Read extracted frames
        frame_files = sorted([
            f for f in os.listdir(tmpdir) if f.startswith("frame_") and f.endswith(".jpg")
        ])

        for i, fname in enumerate(frame_files):
            fpath = os.path.join(tmpdir, fname)
            img = cv2.imread(fpath)
            if img is None:
                continue

            # Read raw JPEG bytes for base64
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
    These are the frames where the codec detected a significant change.
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
    data = json.loads(result.stdout)

    keyframe_times = []
    for frame in data.get('frames', []):
        if frame.get('pict_type') == 'I' and 'pts_time' in frame:
            keyframe_times.append(float(frame['pts_time']))

    return keyframe_times
```

### 1.6 Optical Flow Motion Scoring (`pipeline/motion.py`)

Replace the 64×64 pixel diff with proper OpenCV optical flow.

```python
"""
Optical flow motion scoring using OpenCV Farneback method.

This replaces the browser-side 64×64 pixel diff with dense optical flow,
which detects:
- Motion DIRECTION (not just "something changed")
- Motion MAGNITUDE (how fast things are moving)
- Distinguishes camera pan (uniform flow) from character action (localized flow)

The key insight: a camera pan has uniform optical flow across the frame,
while a sword swing or jump has HIGH flow in one region and LOW flow elsewhere.
We measure the VARIANCE of flow magnitudes — high variance = localized action.
"""
import cv2
import numpy as np
from .types import ExtractedFrame


def compute_optical_flow_scores(frames: list[ExtractedFrame]) -> list[ExtractedFrame]:
    """
    Compute optical flow between consecutive frames.
    
    For each frame, computes:
    - motion_score: 0.0-1.0 overall motion magnitude (normalized)
    - flow_variance: how localized the motion is (high = action, low = pan)
    
    The final motion_score combines magnitude and variance:
        score = 0.4 * magnitude_norm + 0.6 * variance_norm
    
    This weights localized motion (sword swings, jumps) higher than
    global motion (camera pans, scene transitions).
    """
    if len(frames) < 2:
        return frames

    # Convert all frames to grayscale at reduced resolution for speed
    FLOW_SIZE = 160  # compute flow at 160px wide (fast, accurate enough)
    gray_frames = []
    for f in frames:
        h, w = f.image.shape[:2]
        scale = FLOW_SIZE / w
        small = cv2.resize(f.image, (FLOW_SIZE, int(h * scale)))
        gray_frames.append(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))

    magnitudes = []
    variances = []

    # First frame has no motion
    magnitudes.append(0.0)
    variances.append(0.0)

    for i in range(1, len(gray_frames)):
        # Dense optical flow (Farneback)
        flow = cv2.calcOpticalFlowFarneback(
            gray_frames[i - 1],
            gray_frames[i],
            None,
            pyr_scale=0.5,
            levels=3,
            winsize=15,
            iterations=3,
            poly_n=5,
            poly_sigma=1.2,
            flags=0,
        )

        # flow shape: (H, W, 2) — dx, dy per pixel
        mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])

        mean_mag = float(np.mean(mag))
        var_mag = float(np.var(mag))

        magnitudes.append(mean_mag)
        variances.append(var_mag)

    # Normalize to 0-1
    max_mag = max(magnitudes) if max(magnitudes) > 0 else 1.0
    max_var = max(variances) if max(variances) > 0 else 1.0

    for i, frame in enumerate(frames):
        mag_norm = magnitudes[i] / max_mag
        var_norm = variances[i] / max_var

        # Weighted combination: variance matters more (detects localized action)
        frame.motion_score = round(0.4 * mag_norm + 0.6 * var_norm, 4)

    return frames
```

### 1.7 Scene Detection (`pipeline/scenes.py`)

```python
"""
Scene boundary detection using PySceneDetect.

Detects:
- Hard cuts (instant scene changes)
- Fade transitions
- Content-based changes (significant visual shift within a continuous shot)

Scene boundaries are important because action moments often occur
RIGHT AFTER a scene cut (the editor cut TO the action).
"""
from scenedetect import detect, ContentDetector, ThresholdDetector
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
        content_threshold: Sensitivity (lower = more scenes detected, default 27.0)
        min_scene_len_sec: Minimum scene length in seconds
        
    Returns:
        List of SceneBoundary with timestamp and type
    """
    # ContentDetector catches both cuts and gradual transitions
    scene_list = detect(
        video_path,
        ContentDetector(
            threshold=content_threshold,
            min_scene_len=int(min_scene_len_sec * 30),  # assume ~30fps
        ),
    )

    boundaries: list[SceneBoundary] = []
    for scene in scene_list:
        start_time = scene[0].get_seconds()
        end_time = scene[1].get_seconds()
        
        boundaries.append(SceneBoundary(
            timestamp=start_time,
            end_timestamp=end_time,
            duration=round(end_time - start_time, 2),
            scene_type='content_change',
        ))

    return boundaries
```

### 1.8 Multi-Pass Frame Selector (`pipeline/selector.py`)

This is the core intelligence — replaces the simple `selectBestActions()` and `selectHighMotionFrames()` from v1.2.0.

```python
"""
Multi-pass frame selection.

Combines signals from FFmpeg, OpenCV, and PySceneDetect to find
the frames most likely to be ACTION MOMENTS in gameplay footage.

Scoring formula per frame:
    cv_confidence = (
        0.35 * motion_score           # optical flow magnitude + variance
      + 0.25 * scene_proximity_score   # closeness to a scene boundary
      + 0.25 * motion_spike_score      # is this a local peak in motion?
      + 0.15 * temporal_position_score # prefer mid-video over start/end
    )

This replaces three things from v1.2.0:
1. The 64×64 pixel diff (now optical flow)
2. The segment-based selection (now score-based with gap enforcement)
3. The fallback logic in selectBestActions (now a single unified scorer)
"""
import numpy as np
from .types import ExtractedFrame, SceneBoundary, CandidateFrame


def select_best_candidates(
    frames: list[ExtractedFrame],
    scene_boundaries: list[SceneBoundary],
    max_candidates: int = 5,
    min_gap_seconds: float = 2.0,
) -> list[CandidateFrame]:
    """
    Select the best candidate frames for AI analysis.
    
    Multi-pass scoring:
    1. Annotate each frame with scene proximity
    2. Detect local motion peaks (spikes)
    3. Compute temporal position preference
    4. Combine all signals into cv_confidence
    5. Select top-N with minimum gap enforcement
    """
    if not frames:
        return []

    duration = frames[-1].timestamp if frames else 0.0
    boundary_times = [b.timestamp for b in scene_boundaries]

    # === Pass 1: Scene proximity score ===
    # Frames close to scene boundaries score higher (action often follows cuts)
    SCENE_PROXIMITY_WINDOW = 2.0  # seconds
    for frame in frames:
        if not boundary_times:
            frame.scene_proximity_score = 0.0
            continue
        min_dist = min(abs(frame.timestamp - bt) for bt in boundary_times)
        if min_dist <= SCENE_PROXIMITY_WINDOW:
            frame.scene_proximity_score = 1.0 - (min_dist / SCENE_PROXIMITY_WINDOW)
            frame.near_scene_boundary = True
            # Determine type
            exact_match = [b for b in scene_boundaries if abs(b.timestamp - frame.timestamp) < 0.5]
            frame.scene_type = exact_match[0].scene_type if exact_match else 'near_cut'
        else:
            frame.scene_proximity_score = 0.0

    # === Pass 2: Local motion peak detection ===
    # A frame is a "spike" if its motion_score is higher than its neighbors
    scores = [f.motion_score for f in frames]
    for i, frame in enumerate(frames):
        window = scores[max(0, i-2):min(len(scores), i+3)]
        if len(window) >= 3 and frame.motion_score >= max(window) * 0.9:
            frame.motion_spike_score = 1.0
        elif len(window) >= 3:
            frame.motion_spike_score = frame.motion_score / (max(window) + 1e-6)
        else:
            frame.motion_spike_score = 0.5

    # === Pass 3: Temporal position preference ===
    # Slightly prefer frames in the middle 60% of the video
    # (intros and outros rarely have the best action)
    for frame in frames:
        if duration <= 0:
            frame.temporal_score = 0.5
            continue
        t_norm = frame.timestamp / duration  # 0.0 to 1.0
        if 0.15 <= t_norm <= 0.85:
            frame.temporal_score = 1.0
        elif t_norm < 0.15:
            frame.temporal_score = t_norm / 0.15  # ramp up
        else:
            frame.temporal_score = (1.0 - t_norm) / 0.15  # ramp down

    # === Pass 4: Combined CV confidence ===
    for frame in frames:
        frame.cv_confidence = round(
            0.35 * frame.motion_score
            + 0.25 * frame.scene_proximity_score
            + 0.25 * getattr(frame, 'motion_spike_score', 0.0)
            + 0.15 * getattr(frame, 'temporal_score', 0.5),
            4
        )

    # === Pass 5: Select top-N with gap enforcement ===
    sorted_frames = sorted(frames, key=lambda f: f.cv_confidence, reverse=True)
    selected: list[CandidateFrame] = []

    for frame in sorted_frames:
        if len(selected) >= max_candidates:
            break

        # Enforce minimum gap
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

    # Sort by timestamp for timeline ordering
    selected.sort(key=lambda c: c.timestamp)
    return selected
```

### 1.9 Pydantic Types (`pipeline/types.py`)

```python
from pydantic import BaseModel
from dataclasses import dataclass, field
import numpy as np


@dataclass
class ExtractedFrame:
    index: int
    timestamp: float
    image: np.ndarray                          # OpenCV BGR image
    jpeg_base64: str
    motion_score: float = 0.0
    near_scene_boundary: bool = False
    scene_type: str = 'none'
    cv_confidence: float = 0.0
    # Computed in selector
    scene_proximity_score: float = 0.0
    motion_spike_score: float = 0.0
    temporal_score: float = 0.5


class SceneBoundary(BaseModel):
    timestamp: float
    end_timestamp: float
    duration: float
    scene_type: str   # 'content_change', 'hard_cut', 'fade'


class CandidateFrame(BaseModel):
    index: int
    timestamp: float
    motion_score: float
    near_scene_boundary: bool
    scene_type: str
    jpeg_base64: str
    cv_confidence: float
```

---

## Task 2: Update the Cloudflare Worker

### 2.1 Add Container Binding to `wrangler.toml`

Add this to the existing `wrangler.toml`:

```toml
# Add to existing wrangler.toml
[[containers]]
binding = "CV_PIPELINE"
class_name = "CvPipeline"
image = "./src/container/Dockerfile"
instance_type = "basic"     # 1 GiB RAM — enough for OpenCV + FFmpeg
```

### 2.2 Add Container Class to Worker (`src/worker/index.ts`)

```typescript
import { Container } from 'cloudflare:workers';

export class CvPipeline extends Container {
  defaultPort = 8080;
  sleepAfter = '2m';  // sleep after 2 minutes of inactivity
}
```

Update the Env type in `src/worker/types.ts`:

```typescript
export interface Env {
  AI: Ai;
  KV: KVNamespace;
  R2: R2Bucket;
  CV_PIPELINE: DurableObjectNamespace;  // Container binding
}
```

### 2.3 Add New Route: `POST /api/process`

Create `src/worker/routes/process.ts`:

This route orchestrates the full pipeline:
1. Receive session ID
2. Dispatch to Container for CV processing
3. Receive candidate frames from Container
4. Send each candidate to Workers AI for labeling (reuse existing `analyzeFrame()`)
5. Build timeline events from results
6. Store everything in KV
7. Return complete analysis

```typescript
// POST /api/process
// Request: { sessionId: string, maxCandidates?: number, interval?: float }
// Response: {
//   sessionId: string,
//   totalFramesExtracted: number,
//   sceneBoundaries: number,
//   candidates: AnalyzedCandidate[],
//   timeline: TimelineEvent[],
//   processingTimeMs: number,
//   cvProcessingTimeMs: number,
//   aiProcessingTimeMs: number,
// }

// Steps:
// 1. Get session from KV, get video URL from R2
// 2. Call Container: POST /process { video_url, session_id, max_candidates }
// 3. For each candidate returned, call existing analyzeFrame() with the JPEG
//    - Use the existing ANALYSIS_PROMPT from vision.ts
//    - But now we also pass the CV metadata (motion_score, scene_type) in the prompt
//    - This gives the AI model extra context: "This frame has high localized motion
//      and is near a scene cut, suggesting an action moment"
// 4. Build TimelineEvent[] from AI results
//    - timestamp = Math.max(0, candidate.timestamp - 2.5) (same 2.5s pre-offset)
//    - Only include frames where AI confirms isAction=true AND importance >= 7
//    - Fallback: if AI confirms fewer than 2, include the top CV-confidence frames anyway
// 5. Store results in KV, update session status
// 6. Return everything
```

### 2.4 Update the Vision Prompt

Update `src/worker/services/vision.ts` to include CV context in the prompt.

Add a new enhanced prompt that passes CV metadata to the AI:

```
You are analyzing a video frame from a gameplay clip.

COMPUTER VISION PRE-ANALYSIS:
- Motion score: {{motion_score}} (0-1, optical flow magnitude + localization)
- Near scene boundary: {{near_scene_boundary}} ({{scene_type}})
- CV confidence: {{cv_confidence}} (combined multi-signal score)

The CV system detected {{high/low}} localized motion in this frame,
suggesting {{likely/unlikely}} character action.

Your task: CONFIRM or REJECT the CV system's assessment by analyzing
the visual content. Describe what you see, then classify.

[...rest of existing ANALYSIS_PROMPT chain-of-thought structure...]
```

This is crucial — the AI model now has CV priors, making it more accurate. It's not guessing from scratch; it's confirming or rejecting a hypothesis.

### 2.5 Keep Existing Routes

These routes stay unchanged:
- `POST /api/upload` — still uploads video to R2, creates session
- `GET /api/status/:sessionId` — still returns session status from KV
- `POST /api/export` — still generates HTML creative using `html-generator.ts`
- `GET /api/files/:key` — still serves R2 objects
- `GET /api/health` — add Container health check info

Modify `POST /api/analyze` to accept an optional `cvContext` field in the request body, which gets injected into the prompt if present. This keeps backward compatibility (CLI sends CV context, old frontend doesn't).

---

## Task 3: Create the Python CLI Tool

### 3.1 CLI Structure

Create a new directory `cli/` at the project root:

```
cli/
├── pyproject.toml
├── README.md
├── vid2creative/
│   ├── __init__.py
│   ├── __main__.py         # python -m vid2creative
│   ├── cli.py              # Typer app definition
│   ├── client.py           # httpx API client for Worker
│   ├── config.py           # CLI configuration + defaults
│   └── display.py          # Rich formatting helpers
└── tests/
    ├── test_cli.py
    └── test_client.py
```

### 3.2 pyproject.toml

```toml
[project]
name = "vid2creative"
version = "2.0.0"
description = "Convert gameplay videos to interactive HTML5 ad creatives"
requires-python = ">=3.10"
dependencies = [
    "typer>=0.12,<1.0",
    "rich>=13.0,<14.0",
    "httpx>=0.27,<1.0",
]

[project.scripts]
vid2creative = "vid2creative.cli:app"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### 3.3 CLI Commands (`cli.py`)

```python
import typer
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn
from rich.table import Table
from rich.panel import Panel
from pathlib import Path
from .client import Vid2CreativeClient
from .config import DEFAULT_API_URL, DEFAULT_WIDTH, DEFAULT_HEIGHT

app = typer.Typer(
    name="vid2creative",
    help="Convert gameplay videos to interactive HTML5 ad creatives",
    no_args_is_help=True,
)
console = Console()


@app.command()
def process(
    video: Path = typer.Argument(..., help="Path to MP4 video file", exists=True),
    output: Path = typer.Option("creative.html", "--output", "-o", help="Output HTML file path"),
    width: int = typer.Option(DEFAULT_WIDTH, "--width", "-w"),
    height: int = typer.Option(DEFAULT_HEIGHT, "--height", "-h"),
    click_url: str = typer.Option("", "--click-url", "-u", help="CTA click-through URL"),
    max_buttons: int = typer.Option(4, "--max-buttons", "-n", help="Max CTA buttons (1-6)"),
    style: str = typer.Option("pulse", "--style", "-s", help="Button style: primary|pulse|glow|glass|bounce"),
    poster_frame: int = typer.Option(0, "--poster-frame", "-p", help="Poster frame index"),
    api_url: str = typer.Option(DEFAULT_API_URL, "--api-url", help="Worker API base URL"),
    loop: bool = typer.Option(False, "--loop", help="Loop video in creative"),
    interval: float = typer.Option(1.0, "--interval", "-i", help="Frame extraction interval (seconds)"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show detailed processing info"),
):
    """
    Process a gameplay video into an interactive HTML5 ad creative.
    
    Full pipeline: upload → CV analysis → AI labeling → HTML export
    """
    client = Vid2CreativeClient(api_url)
    
    # Validate
    if not video.suffix.lower() in ('.mp4', '.webm', '.mov'):
        console.print("[red]Error:[/red] Only .mp4, .webm, and .mov files are supported")
        raise typer.Exit(1)

    if video.stat().st_size > 100 * 1024 * 1024:
        console.print("[red]Error:[/red] Video must be under 100MB")
        raise typer.Exit(1)

    console.print(Panel(
        f"[bold]vid2creative v2.0[/bold]\n"
        f"Video: {video.name} ({video.stat().st_size / 1024 / 1024:.1f} MB)\n"
        f"Output: {output}\n"
        f"Dimensions: {width}×{height}",
        title="Processing",
        border_style="blue",
    ))

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        console=console,
    ) as progress:

        # Step 1: Upload
        task = progress.add_task("Uploading video...", total=100)
        session = client.upload(video)
        progress.update(task, completed=100)
        console.print(f"  Session: [cyan]{session['sessionId']}[/cyan]")

        # Step 2: CV + AI Processing (Container does the heavy work)
        task = progress.add_task("Analyzing video (CV + AI)...", total=100)
        result = client.process(
            session_id=session['sessionId'],
            max_candidates=max_buttons,
            interval=interval,
        )
        progress.update(task, completed=100)

        # Display results
        if verbose:
            _display_analysis(result)

        console.print(
            f"  Frames extracted: [green]{result['totalFramesExtracted']}[/green] | "
            f"Scene cuts: [green]{result['sceneBoundaries']}[/green] | "
            f"Action moments: [green]{len(result['timeline'])}[/green]"
        )
        console.print(
            f"  CV time: {result['cvProcessingTimeMs']}ms | "
            f"AI time: {result['aiProcessingTimeMs']}ms"
        )

        # Step 3: Export HTML
        task = progress.add_task("Generating HTML creative...", total=100)
        html = client.export(
            session_id=session['sessionId'],
            config={
                'width': width,
                'height': height,
                'posterFrameIndex': poster_frame,
                'autoplayAfterTap': True,
                'loopVideo': loop,
                'muteByDefault': True,
                'backgroundColor': '#000000',
                'clickThroughUrl': click_url,
                'timeline': result['timeline'],
            },
        )
        progress.update(task, completed=100)

        # Write output
        output.write_text(html)
        console.print(f"\n[bold green]✓ Creative exported to {output}[/bold green]")
        console.print(f"  File size: {output.stat().st_size / 1024:.1f} KB")


@app.command()
def analyze(
    video: Path = typer.Argument(..., help="Path to MP4 video file", exists=True),
    format: str = typer.Option("table", "--format", "-f", help="Output format: table|json"),
    api_url: str = typer.Option(DEFAULT_API_URL, "--api-url"),
    max_candidates: int = typer.Option(10, "--max-candidates", "-n"),
    interval: float = typer.Option(1.0, "--interval", "-i"),
):
    """
    Analyze a video without exporting. Shows detected action moments.
    """
    client = Vid2CreativeClient(api_url)

    with console.status("Uploading..."):
        session = client.upload(video)

    with console.status("Analyzing (CV + AI pipeline)..."):
        result = client.process(
            session_id=session['sessionId'],
            max_candidates=max_candidates,
            interval=interval,
        )

    if format == 'json':
        import json
        console.print_json(json.dumps(result, indent=2))
    else:
        _display_analysis(result)


@app.command()
def status(
    api_url: str = typer.Option(DEFAULT_API_URL, "--api-url"),
):
    """Check API health and daily neuron usage."""
    client = Vid2CreativeClient(api_url)
    health = client.health()
    console.print(Panel(
        f"API: [green]{health['status']}[/green]\n"
        f"Version: {health.get('version', 'unknown')}\n"
        f"Container: {health.get('container', 'unknown')}",
        title="vid2creative status",
    ))


def _display_analysis(result: dict):
    """Pretty-print analysis results as a Rich table."""
    table = Table(title="Detected Action Moments")
    table.add_column("Time", style="cyan", width=8)
    table.add_column("Motion", style="yellow", width=8)
    table.add_column("CV Conf", style="green", width=8)
    table.add_column("Scene Cut", width=10)
    table.add_column("AI Action", width=10)
    table.add_column("Label", style="bold")
    table.add_column("Importance", width=10)

    for c in result.get('candidates', []):
        table.add_row(
            f"{c['timestamp']:.1f}s",
            f"{c['motionScore']:.2f}",
            f"{c['cvConfidence']:.2f}",
            "✓" if c.get('nearSceneBoundary') else "—",
            "✓" if c.get('isAction') else "✗",
            c.get('actionLabel', '—'),
            str(c.get('importance', '—')),
        )

    console.print(table)
```

### 3.4 API Client (`client.py`)

```python
import httpx
from pathlib import Path


class Vid2CreativeClient:
    def __init__(self, base_url: str, timeout: float = 120.0):
        self.base_url = base_url.rstrip('/')
        self.client = httpx.Client(timeout=timeout)

    def health(self) -> dict:
        r = self.client.get(f"{self.base_url}/api/health")
        r.raise_for_status()
        return r.json()

    def upload(self, video_path: Path) -> dict:
        with open(video_path, 'rb') as f:
            r = self.client.post(
                f"{self.base_url}/api/upload",
                files={"video": (video_path.name, f, "video/mp4")},
            )
        r.raise_for_status()
        return r.json()

    def process(self, session_id: str, max_candidates: int = 5, interval: float = 1.0) -> dict:
        r = self.client.post(
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
        r = self.client.post(
            f"{self.base_url}/api/export",
            json={"sessionId": session_id, "config": config},
        )
        r.raise_for_status()
        return r.text
```

### 3.5 Config (`config.py`)

```python
DEFAULT_API_URL = "https://vid2creative.napptixaiuse.workers.dev"
DEFAULT_WIDTH = 360
DEFAULT_HEIGHT = 640
```

---

## Task 4: Update Existing Worker Code

### 4.1 Changes to `src/worker/index.ts`

1. Import and register the `CvPipeline` Container class
2. Add `POST /api/process` route (delegates to Container + AI)
3. Keep all existing routes functional (backward compat)
4. Add Container health to `/api/health` response

### 4.2 Changes to `src/worker/services/vision.ts`

1. Add new `ENHANCED_ANALYSIS_PROMPT` that includes CV context placeholders
2. Add `analyzeWithCvContext(frame, cvMetadata, env)` function that injects CV data into the prompt
3. Keep existing `analyzeFrame()` for backward compatibility
4. Existing validation rules stay the same (importance < 7 → reject, running = not action, etc.)

### 4.3 Changes to `src/worker/types.ts`

Add new types:

```typescript
// CV Pipeline types (from Container)
interface CvCandidate {
  index: number;
  timestamp: number;
  motionScore: number;
  nearSceneBoundary: boolean;
  sceneType: string;
  jpegBase64: string;
  cvConfidence: number;
}

interface ProcessRequest {
  sessionId: string;
  maxCandidates?: number;
  interval?: number;
}

interface ProcessResponse {
  sessionId: string;
  totalFramesExtracted: number;
  sceneBoundaries: number;
  candidates: AnalyzedCandidate[];
  timeline: TimelineEvent[];
  processingTimeMs: number;
  cvProcessingTimeMs: number;
  aiProcessingTimeMs: number;
}

interface AnalyzedCandidate extends CvCandidate {
  // Added by AI analysis
  isAction: boolean;
  actionType: string;
  actionLabel: string;
  importance: number;
  sceneType: string;
  mood: string;
  cta: CTAButton;
  animationSuggestion: AnimationType;
}
```

---

## Task 5: Remove Frontend

1. Delete `src/frontend/` directory entirely
2. Remove Vite config (`vite.config.ts`)
3. Remove `[assets]` section from `wrangler.toml` (no more static site serving)
4. Remove frontend-related npm dependencies (react, react-dom, tailwindcss, etc.)
5. Keep the Worker serving API routes only
6. Update `package.json` scripts — remove `build` (Vite), keep `deploy` (wrangler)

---

## Task 6: Testing

### 6.1 Container Tests

Write pytest tests for each pipeline module:

**`test_extract.py`:**
- Test `get_video_info()` with a sample MP4 (include a 5-second test video in `tests/fixtures/`)
- Test `extract_keyframes()` returns correct number of frames for given interval
- Test frames have valid JPEG base64 and non-zero dimensions
- Test `get_keyframe_timestamps()` returns sorted float list

**`test_motion.py`:**
- Test `compute_optical_flow_scores()` with 3 frames (static → motion → static)
- Verify motion_score of static frames is near 0
- Verify motion_score of motion frame is significantly higher
- Test with single frame (should not crash)

**`test_scenes.py`:**
- Test `detect_scene_boundaries()` with a video that has a known hard cut
- Verify boundary timestamps are within 0.5s of ground truth

**`test_selector.py`:**
- Test `select_best_candidates()` with synthetic frames (fake motion scores)
- Verify min_gap_seconds enforcement
- Verify max_candidates limit
- Test edge case: all frames have motion_score=0 (should still return candidates)
- Test edge case: 1 frame only

### 6.2 Worker Tests

Add to existing test suite:
- Test `POST /api/process` route with mocked Container response
- Test enhanced vision prompt includes CV context
- Test timeline building from analyzed candidates (2.5s pre-offset)
- Test fallback: fewer than 2 AI-confirmed actions → include CV-high frames

### 6.3 CLI Tests

- Test `process` command with mocked API responses
- Test `analyze` command JSON output format
- Test file validation (wrong extension, too large)
- Test `status` command

---

## Invariants (v2.0 additions)

All v1.2.0 invariants still apply, plus:

| ID  | Rule |
|-----|------|
| I13 | Container must respond within 60 seconds for any video under 2 minutes |
| I14 | Optical flow computation must use 160px width (not full resolution) |
| I15 | Scene detection threshold must be configurable but default to 27.0 |
| I16 | CLI must show progress for every pipeline stage (upload, CV, AI, export) |
| I17 | Container must clean up temp files — never leak video data to disk |
| I18 | The `/api/process` route must return both CV metadata AND AI results per candidate |
| I19 | If Container is unreachable, `/api/process` must return 503 with clear error |
| I20 | The enhanced AI prompt must include CV confidence score so the model can calibrate |
| I21 | CLI `process` command must work end-to-end with a single command — no multi-step interaction |
| I22 | Container Dockerfile must pin all major dependency versions (no floating latest) |

---

## Migration Checklist

Execute in this order:

1. [ ] Create `src/container/` with Dockerfile, requirements.txt, all pipeline modules
2. [ ] Create `src/container/pipeline/types.py` with Pydantic/dataclass models
3. [ ] Implement `extract.py` — FFmpeg frame extraction
4. [ ] Implement `motion.py` — OpenCV optical flow scoring
5. [ ] Implement `scenes.py` — PySceneDetect boundary detection
6. [ ] Implement `selector.py` — multi-pass candidate selection
7. [ ] Implement `main.py` — FastAPI server with `/process` endpoint
8. [ ] Write container tests (use a 5-second test fixture video)
9. [ ] Update `wrangler.toml` — add Container binding
10. [ ] Add `CvPipeline` Container class to Worker
11. [ ] Create `src/worker/routes/process.ts` — new orchestration route
12. [ ] Update `src/worker/services/vision.ts` — add enhanced prompt with CV context
13. [ ] Update `src/worker/types.ts` — add CV types
14. [ ] Delete `src/frontend/` directory
15. [ ] Remove Vite config + frontend npm deps
16. [ ] Create `cli/` directory with Typer CLI tool
17. [ ] Implement `cli/vid2creative/client.py` — httpx API wrapper
18. [ ] Implement `cli/vid2creative/cli.py` — all CLI commands
19. [ ] Write CLI tests
20. [ ] Test full pipeline: `vid2creative process test.mp4 -o out.html`
21. [ ] Deploy: `npx wrangler deploy`
22. [ ] Update SRS document to v2.0
