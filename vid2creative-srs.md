# vid2creative — Software Requirements & Reference Specification

> Complete technical reference for the vid2creative project. Read before touching any file.

**Version:** 1.2.0
**Deployed at:** https://vid2creative.napptixaiuse.workers.dev
**Last updated:** 2026-03-26

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Layout](#2-repository-layout)
3. [Tech Stack](#3-tech-stack)
4. [Architecture Overview](#4-architecture-overview)
5. [Worker API (Backend)](#5-worker-api-backend)
6. [Frontend Components](#6-frontend-components)
7. [Full Data Flow](#7-full-data-flow)
8. [AI Vision Pipeline](#8-ai-vision-pipeline)
9. [Motion Detection System](#9-motion-detection-system)
10. [HTML5 Creative Output Format](#10-html5-creative-output-format)
11. [Types Reference](#11-types-reference)
12. [Cloudflare Bindings & Config](#12-cloudflare-bindings--config)
13. [Known Issues & Limitations](#13-known-issues--limitations)
14. [Deployment Commands](#14-deployment-commands)

---

## 1. Project Overview

**vid2creative** converts any MP4 gameplay video into a standalone interactive HTML5 ad creative (playable ad) for adtech/programmatic advertising. The output is a self-contained `.html` file that:

- Displays a poster frame with a CTA button on load
- Plays the source video when tapped (autoplay-safe — starts on user interaction)
- Shows contextual CTA buttons at AI-detected action moments during playback
- Pauses the video briefly when a CTA appears so the viewer sees it
- Resumes on next tap, returns to poster when video ends
- Works in any DSP/ad server that supports HTML5 MRAID or standard `<iframe>` units

### Target Use Case

A game publisher uploads a 20–30 second gameplay clip. The system automatically:
1. Extracts frames at a configurable interval
2. Detects high-motion moments (combat, jumps, special moves) using pixel diff — free, runs in browser
3. Sends only the top 10 candidate frames to Workers AI for scene classification
4. Places CTA buttons 2.5 seconds BEFORE detected action moments so buttons appear before the animation
5. Gives the user a video editor to preview, adjust, and add buttons
6. Exports a single `.html` file ready for ad serving

---

## 2. Repository Layout

```
vid22/
├── src/
│   ├── worker/                     ← Cloudflare Worker (backend)
│   │   ├── index.ts                ← Hono router, all HTTP routes
│   │   ├── types.ts                ← Shared backend TypeScript types + AppError
│   │   ├── routes/
│   │   │   ├── upload.ts           ← POST /api/upload — creates session, stores video to R2
│   │   │   ├── analyze.ts          ← POST /api/analyze — vision model inference per frame
│   │   │   ├── status.ts           ← GET /api/status/:sessionId — session status
│   │   │   └── export.ts           ← POST /api/export — generates HTML creative
│   │   └── services/
│   │       ├── vision.ts           ← Workers AI vision model calls + response parsing
│   │       ├── html-generator.ts   ← generateCreativeHtml() — builds the output .html
│   │       └── storage.ts          ← KV + R2 helpers (session CRUD, frame data, usage tracking)
│   └── frontend/                   ← React 18 SPA (served as static assets from ./dist)
│       ├── App.tsx                 ← Root component, 4-step wizard state machine
│       ├── main.tsx                ← React entry point
│       ├── index.css               ← Tailwind base styles
│       ├── lib/
│       │   ├── types.ts            ← Frontend TypeScript types (mirrors worker types)
│       │   └── api.ts              ← fetch wrappers for all Worker API endpoints
│       └── components/
│           ├── VideoUploader.tsx   ← Step 1: drag-drop upload, creates session
│           ├── FrameExtractor.tsx  ← Step 2: client-side extraction + pixel diff + AI analysis
│           ├── OverlayEditor.tsx   ← Step 3: video editor, timeline, button placement
│           └── ExportPanel.tsx     ← Step 4: config, preview, HTML download
├── wrangler.toml                   ← Cloudflare Workers config (AI, KV, R2, assets)
├── package.json
├── tsconfig.json
└── vite.config.ts                  ← Frontend build config (outputs to ./dist)
```

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (V8 isolate, ESM) |
| Backend framework | Hono v4 (router + middleware) |
| Storage — sessions | Cloudflare KV (TTL: 24h) |
| Storage — frames/video | Cloudflare R2 (vid2creative-assets bucket) |
| AI Vision | `@cf/meta/llama-3.2-11b-vision-instruct` via Workers AI |
| Frontend framework | React 18 + TypeScript |
| Frontend styling | Tailwind CSS (dark theme, gray-950 background) |
| Frontend build | Vite → `./dist` → served as Cloudflare static assets |
| Frame extraction | HTML5 `<video>` + `<canvas>` (client-side, zero server cost) |
| Motion detection | Pixel difference on 64×64 thumbnails — runs in browser, free |
| Creative format | Standalone HTML5 (no dependencies, works in any iframe/ad tag) |

### Important Constraints

- **No Node.js built-ins** — Worker is pure Cloudflare V8 runtime. No `fs`, `path`, etc.
- **Workers AI is stateless** — each frame analysis is an independent HTTP call to `env.AI.run()`
- **All frame extraction is client-side** — video never fully uploads to the server; only JPEG thumbnails are sent for AI analysis
- **Video IS uploaded to R2** for playback in the exported creative — the export HTML references the R2 URL

---

## 4. Architecture Overview

```
User Browser
     │
     │  1. Upload video file
     ▼
VideoUploader ──POST /api/upload──► Worker
                                      │ Creates session in KV
                                      │ Stores video to R2
                                      └─► Returns { sessionId, videoUrl }
     │
     │  2. Extract frames locally (client-side canvas)
     ▼
FrameExtractor
  │  a. Draw each frame to 640px canvas at N-second intervals
  │  b. Compute pixel diff on 64×64 thumbnail → motionScore 0-1
  │  c. Divide video into 10 equal segments, pick peak-motion frame from each
  │  d. Send 10 candidate frames to Worker AI for classification
     │
     │  POST /api/analyze (per frame, sequential)
     ▼
Worker → analyzeFrame() → Workers AI llama-3.2-11b-vision-instruct
                                      │
                                      └─► Returns isAction, actionType, actionLabel,
                                           importance, cta config, animationSuggestion
     │
     │  3. User edits timeline in video editor
     ▼
OverlayEditor
  │  Live <video> element with RAF playback tracking
  │  "Add Action Here" places button 1.5s before current position
  │  Visual timeline with draggable event blocks
  │  Live CTA overlay preview on video
     │
     │  4. Export
     ▼
ExportPanel ──POST /api/export──► Worker → generateCreativeHtml()
                                      │
                                      └─► Returns standalone .html blob
                                           User downloads it
```

---

## 5. Worker API (Backend)

**Entry point:** `src/worker/index.ts` — Hono router

### Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health check → `{ status: 'ok', version: '1.0.0' }` |
| `POST` | `/api/upload` | Upload video, create session |
| `POST` | `/api/analyze` | Analyze one frame with vision model |
| `GET` | `/api/status/:sessionId` | Get session + frame analysis results |
| `POST` | `/api/export` | Generate HTML creative |
| `GET` | `/api/files/:key` | Serve R2 objects (frames, videos) |
| `PUT` | `/api/session/:sessionId` | Update session (totalFrames, status) |
| `POST` | `/api/debug/vision` | Raw vision model test with multiple input formats |

### POST /api/upload

Creates a session in KV, uploads the video file to R2.

**Request:** `multipart/form-data` with `video` file field
**Response:** `{ sessionId, videoUrl, status: 'ready' }`

### POST /api/analyze

Sends one JPEG frame to the Workers AI vision model.

**Request body:**
```typescript
{
  sessionId: string;
  frameIndex: number;
  timestamp: number;          // seconds from video start
  imageBase64: string;        // base64 JPEG
  isRefinement?: boolean;     // true = use short refinement prompt, skip R2/counter
}
```

**Response:**
```typescript
{
  frameIndex: number;
  analysis: FrameAnalysis;
  rawResponse: string;        // first 300 chars of model response (for debugging)
  neurons: {
    used: number;             // estimated neurons for this call (~66 normal, ~33 refinement)
    dailyTotal: number;       // cumulative daily usage
    dailyLimit: number;       // 10000
    warning: boolean;         // true when dailyTotal >= 8000
  };
}
```

**Limits:**
- `MAX_FRAMES_PER_SESSION = 200` — skipped for `isRefinement: true`
- `DAILY_NEURON_LIMIT = 10000` — shared across all users, tracked in KV

### POST /api/export

**Request body:** `{ sessionId: string, config: CreativeConfig }`
**Response:** HTML file as `text/html` blob

The worker resolves the video URL and poster frame URL from R2, then calls `generateCreativeHtml()`.

---

## 6. Frontend Components

### App.tsx — 4-Step Wizard

State machine with steps: `upload → extract → edit → export`

**Key state:**
- `videoFile: File` — the uploaded video (also passed to OverlayEditor for live preview)
- `session: Session` — sessionId + videoUrl from upload
- `frames: ExtractedFrame[]` — all extracted frames with analysis results
- `config: CreativeConfig` — dimensions, timeline events, poster frame, URLs

**`handleAnalysisComplete(analyzedFrames)`:** builds initial `TimelineEvent[]` from selected frames:
- Timestamp: `f.refinedTimestamp ?? Math.max(0, f.timestamp - 2.5)` (2.5s before detected action)
- Duration: `0.6s` (quick flash)
- Always sets `pauseVideo: true` on action events

### VideoUploader.tsx — Step 1

Drag-and-drop or file picker for MP4/WebM files. Calls `POST /api/upload`. On success, calls `onComplete(file, session)` to advance to Step 2.

### FrameExtractor.tsx — Step 2

**Constants:**
```typescript
const MAX_ACTIONS = 4;        // max buttons in the final creative
const AI_CANDIDATES = 10;     // frames sent to AI
const MIN_ACTION_GAP = 2;     // min seconds between selected action events
const DIFF_SIZE = 64;         // thumbnail size for pixel comparison
const MOTION_THRESHOLD = 0.08;// UI coloring only (red bars above this)
```

**Phases:** `idle → extracting → detecting → analyzing → done`

**Extraction flow:**
1. Create `<video>` element, seek to each timestamp at `interval` seconds
2. Draw to 640px canvas, compute pixel diff on 64×64 canvas (see §9)
3. After all frames extracted: `selectHighMotionFrames(extracted, AI_CANDIDATES)` — segment-based selection
4. Send each candidate to `POST /api/analyze` sequentially
5. `selectBestActions(frames, MAX_ACTIONS)` — picks `isAction=true AND importance>=6`, with motion-score fallback if AI found no actions
6. Marks selected frames with `isSelected: true` and `refinedTimestamp = timestamp - 2.5`

**UI:** Motion intensity bar chart (colored bars per frame), frame thumbnail strip, inspected frame detail panel.

### OverlayEditor.tsx — Step 3

Full video editor for reviewing and adjusting button placements before export.

**Props:** `videoFile: File, frames: ExtractedFrame[], config: CreativeConfig, onConfigChange, onNext`

**Video playback:**
- Live `<video>` element with `URL.createObjectURL(videoFile)`
- `requestAnimationFrame` tick reads `video.currentTime` to drive playhead and overlay preview
- Custom controls: Play/Pause, time display `0:03.2 / 0:19.0`, speed buttons (0.25x / 0.5x / 1x)

**`addActionHere()`:**
```typescript
timestamp: Math.max(0, Math.round((ts - 1.5) * 10) / 10),  // 1.5s BEFORE click
duration: 0.6,                                               // quick flash
```
When the user clicks this button mid-playback, the video pauses and a new timeline event is created at 1.5 seconds BEFORE the current position — because the user naturally clicks AT the action, but the button should appear BEFORE it.

**Timeline bar:**
- Draggable event blocks positioned at `(timestamp / videoDuration) * 100%`
- Yellow tick marks for AI-suggested action frames
- Playhead line tracking current video time
- Click on event → opens edit panel for that event's CTA, style, animation, duration

**Live overlay preview:**
- During playback, CTAs in `config.timeline` with `timestamp <= currentTime < timestamp + duration` are rendered as absolutely-positioned overlays on the video

**Duration input:** `min={0.3} max={30} step={0.1}`

### ExportPanel.tsx — Step 4

**Config options:**
- Preset dimensions: Mobile 360×640, Mobile Alt 320×480, Banner 300×250, Square 400×400
- Custom width/height inputs
- Poster frame picker (thumbnail strip)
- Click-through URL
- Background color picker
- Loop video / Mute by default checkboxes

**Preview button:** calls `POST /api/export`, renders HTML in `<iframe srcDoc={...} sandbox="allow-scripts" />`

**Export button:** calls `POST /api/export`, triggers browser download as `creative-{sessionId}.html`

---

## 7. Full Data Flow

```
1. User selects video file
   └─► VideoUploader
        ├─ POST /api/upload { video: File }
        └─► Worker creates session in KV, stores video to R2
             └─► Returns { sessionId, videoUrl }

2. Client extracts frames
   └─► FrameExtractor
        ├─ Create <video>, seek to 0s, 1s, 2s... N×interval
        ├─ For each frame:
        │   ├─ ctx.drawImage(video) → 640px JPEG blob
        │   ├─ diffCtx.drawImage(canvas, 64px) → pixel diff vs prev frame
        │   └─ Store motionScore (0-1)
        │
        ├─ selectHighMotionFrames(frames, 10)
        │   └─ Divide into 10 equal segments, pick peak motion from each
        │
        └─ For each candidate frame:
            ├─ POST /api/analyze { sessionId, frameIndex, timestamp, imageBase64 }
            └─► Worker → analyzeFrame() → Workers AI llama-3.2-11b-vision-instruct
                 └─► Returns { isAction, actionType, actionLabel, importance, cta, ... }

3. selectBestActions(frames, 4)
   ├─ Filter: isAction=true AND importance >= 6
   ├─ Sort by importance descending
   ├─ Enforce MIN_ACTION_GAP=2s between selections
   └─ Fallback: if no actions found, use top-4 by motionScore

4. Build TimelineEvent[] in App.tsx handleAnalysisComplete()
   └─ timestamp = refinedTimestamp ?? max(0, frame.timestamp - 2.5)
      duration = 0.6s
      pauseVideo = true

5. OverlayEditor — user reviews and adjusts
   └─ Can add manual events with "Add Action Here" (1.5s before click point)
   └─ Can drag events on timeline, edit CTA text/style/position

6. ExportPanel → POST /api/export
   └─► Worker:
        ├─ Gets video URL (R2 public URL)
        ├─ Gets poster frame URL (R2 URL of frames/{sessionId}/{posterFrameIndex}.jpg)
        └─ generateCreativeHtml(config, videoUrl, posterFrameUrl)
             └─► Returns standalone .html file
```

---

## 8. AI Vision Pipeline

**Model:** `@cf/meta/llama-3.2-11b-vision-instruct`
**Source:** `src/worker/services/vision.ts`

### Main Analysis Prompt (`ANALYSIS_PROMPT`)

Chain-of-thought prompt that forces the model to:
1. Describe CHARACTER BODY (standing / crouching / airborne / rolling)
2. Describe WEAPON/EFFECTS (impact flash? slash trail? just held?)
3. Describe MOVEMENT (blur? action pose? still?)
4. THEN classify using strict rules

**Action types:**
- `attack` — weapon actively hitting, must see impact sparks/flash/slash trail
- `dodge` — body low to ground, rolling, tumbling, evasive
- `jump` — feet clearly off ground, airborne
- `shoot` — projectile or arrow visibly flying
- `spell` — glowing magic effects from character
- `none` — standing, running, walking, idle, menu (running with weapon = none)

**Output JSON fields:**
```json
{
  "description": "chain-of-thought body description",
  "sceneType": "action",
  "mood": "intense",
  "importance": 8,
  "isAction": true,
  "actionType": "attack",
  "actionLabel": "Heavy Strike!",
  "cta": { "text": "Play Now", "position": { "x": 50, "y": 80 }, "style": "pulse", "size": "large" },
  "overlay": { "type": "none", "text": "", "position": "top-right" },
  "animationSuggestion": "shake"
}
```

### Strict Validation Rules (in `parseAnalysisResponse`)

Applied after JSON parse to prevent false positives:

1. `actionType === 'none'` → force `isAction = false`
2. `isAction=true AND importance < 7` → force `isAction = false` (low-confidence actions rejected)
3. Description mentions jump/airborne + actionType='attack' → correct to `jump`
4. Description mentions roll/dodge + actionType='attack' → correct to `dodge`
5. Description mentions swing/slash + actionType='jump' → correct to `attack`
6. Description mentions "running/walking/moving forward" (without "while/slash/swing") → force `isAction = false`

### Refinement Prompt (`REFINEMENT_PROMPT`)

Shorter prompt for sub-frame analysis (used with `isRefinement: true`). Returns minimal JSON:
```json
{ "isAction": false, "actionType": "none", "actionLabel": "", "importance": 5 }
```
Requires `importance >= 7` to confirm action.

### Fallback Chain

1. **Attempt 0:** Full `ANALYSIS_PROMPT` → try `parseAnalysisResponse()`
2. **Attempt 1:** Short "describe body position" prompt → try `parseAnalysisResponse()`, if fails try `buildFromDescription()` (keyword heuristics)
3. **All attempts fail:** Return `DEFAULT_ANALYSIS` (isAction=false, importance=5)

### Neuron Budget

- Normal frame: ~66 neurons estimated
- Refinement frame: ~33 neurons
- Daily limit: 10,000 neurons (`DAILY_NEURON_LIMIT`)
- Warning threshold: 8,000 neurons (80%)
- Usage tracked in KV key `daily_neurons:{YYYY-MM-DD}`

---

## 9. Motion Detection System

**Source:** `src/frontend/components/FrameExtractor.tsx` — `computeMotionScore()`, `selectHighMotionFrames()`

Runs entirely in the browser — zero API cost. Cuts AI calls by ~80%.

### computeMotionScore()

```typescript
function computeMotionScore(
  ctx: CanvasRenderingContext2D,     // 64×64 canvas with willReadFrequently: true
  prevData: Uint8ClampedArray | null,
  diffCanvas: HTMLCanvasElement,
  fullCanvas: HTMLCanvasElement,     // source 640px frame
): { score: number; pixelData: Uint8ClampedArray }
```

1. Scale full frame down to 64×64 via `ctx.drawImage(fullCanvas, 0, 0, 64, 64)`
2. `ctx.getImageData(0, 0, 64, 64).data` → 4096 RGBA pixels
3. For each pixel: `avgDiff = (|R₁-R₀| + |G₁-G₀| + |B₁-B₀|) / 3`
4. `score = sum(avgDiff) / (4096 × 255)` → 0.0 to 1.0

### selectHighMotionFrames() — Segment-Based Selection

Guarantees buttons are spread across the full video (not clustered at high-energy sections):

```typescript
function selectHighMotionFrames(frames: ExtractedFrame[], maxCount: number): ExtractedFrame[] {
  // Divide frames array into maxCount equal segments
  // Pick the frame with highest motionScore from each segment
}
```

Example: 20 frames, maxCount=10 → 2 frames per segment → one candidate from each 2-frame window

**Why not top-N by score?** Top-N clusters candidates at the most action-heavy part of the video (usually the last few seconds of a gameplay clip). Segment-based selection ensures even a quiet intro frame gets one candidate slot.

### selectBestActions() — Post-AI Selection

```typescript
function selectBestActions(frames: ExtractedFrame[], maxCount: number): ExtractedFrame[] {
  // 1. Filter: analysisStatus='done' AND isAction=true AND importance >= 6
  // 2. Sort by importance descending
  // 3. Enforce MIN_ACTION_GAP=2s between selections
  // 4. Fallback: if no actions found, use top-N by motionScore
}
```

The `importance >= 6` threshold in `selectBestActions` combined with the `importance < 7 → isAction=false` rule in `vision.ts` means only frames with importance ≥ 7 can become buttons via the AI path. The motion-score fallback only activates when AI finds **zero** actions.

---

## 10. HTML5 Creative Output Format

**Source:** `src/worker/services/html-generator.ts` — `generateCreativeHtml()`

The output is a completely self-contained HTML file. No external CSS/JS dependencies.

### Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <style> /* all CSS inlined */ </style>
</head>
<body>
  <div class="creative" id="creative">   <!-- width×height container -->
    <video id="video" playsinline muted preload="auto" poster="...">
      <source src="R2_VIDEO_URL" type="video/mp4">
    </video>

    <!-- Shown on load, hidden when video starts -->
    <div class="poster-overlay" id="poster" style="background-image:url('POSTER_URL')">
      <a class="cta-btn poster-cta large pulse anim-pulse" ...>Play Now</a>
      <div class="tap-hint">Tap to play</div>
    </div>

    <!-- Hidden on load, shown when video plays -->
    <div id="timeline-overlays" style="display:none">
      <a class="cta-btn medium primary"
         data-show-at="5.5" data-hide-at="6.1"
         data-anim="fade-in" data-pause="true">
        Heavy Strike!
      </a>
    </div>
  </div>
  <script> /* all JS inlined */ </script>
</body>
</html>
```

### CSS Classes

**Button styles:** `primary`, `secondary`, `floating`, `pulse`, `glow`, `slide-in`, `bounce`, `glass`
**Button sizes:** `small` (8px 16px padding), `medium` (12px 28px), `large` (16px 36px)
**Button position:** `left: X%; top: Y%` with `transform: translate(-50%, -50%)` — centered on the % point
**Animations:** `anim-fade-in`, `anim-slide-up`, `anim-slide-left`, `anim-slide-right`, `anim-zoom-in`, `anim-bounce`, `anim-pulse`, `anim-glow`, `anim-shake`

**Overlay types:** `badge`, `ribbon`, `progress_bar` (plus `logo`, `score_display`, `timer`)
**Overlay positions:** `pos-top-left`, `pos-top-right`, `pos-bottom-left`, `pos-bottom-right`, `pos-center`

### Timeline JS Logic

The inlined script listens to `video.timeupdate` and shows/hides CTAs based on `data-show-at` / `data-hide-at`:

```javascript
o.forEach(function(el) {
  var s = parseFloat(el.dataset.showAt);
  var h = parseFloat(el.dataset.hideAt || '9999');
  if (c >= s && c < h) {
    if (!el.classList.contains('visible')) {
      el.classList.add('visible', 'anim-' + an);
      el.style.opacity = '';
      if (el.dataset.pause === 'true' && !paused) {
        paused = true; v.pause();     // auto-pause when CTA appears
      }
    }
  } else if (c >= h && el.classList.contains('visible')) {
    el.classList.remove('visible');
    el.style.opacity = '0';
  }
});
```

**Tap-to-resume:** After auto-pause, clicking anywhere on the creative resumes playback.

### Poster vs Timeline Events

Events where `frameIndex === config.posterFrameIndex` become **poster CTAs** (shown on the static thumbnail before video starts). All other events become **timeline CTAs** (shown during video playback based on timestamps).

**Important:** If the poster frame index equals any timeline event's `frameIndex`, that event appears on the poster overlay AND is excluded from the video timeline. It will not fire during playback.

### Button Actions

- `link` — `<a href="...">` tag, opens click-through URL in new tab
- `play` — resumes video
- `pause` — pauses video
- `replay` — seeks to 0 and plays
- `mute_toggle` — toggles video mute

---

## 11. Types Reference

**Source:** `src/frontend/lib/types.ts` (frontend mirrors `src/worker/types.ts`)

### ExtractedFrame

```typescript
interface ExtractedFrame {
  index: number;
  timestamp: number;                   // seconds from start
  blob: Blob;                          // JPEG thumbnail
  base64: string;                      // base64 JPEG (sent to API)
  thumbnailUrl: string;                // Object URL for <img> display
  analysis?: FrameAnalysis;            // AI analysis result (if analyzed)
  analysisStatus: 'pending' | 'analyzing' | 'done' | 'error';
  refinedTimestamp?: number;           // timestamp - 2.5s (for button placement)
  isSelected?: boolean;                // true = used in timeline
  motionScore?: number;                // 0-1 pixel diff score
}
```

### TimelineEvent

```typescript
interface TimelineEvent {
  id: string;
  frameIndex: number;
  timestamp: number;          // when button APPEARS (before the action)
  duration: number;           // how long button shows (default: 0.6s)
  cta: CTAButton;
  overlay: OverlayElement;
  animation: AnimationType;
  pauseVideo: boolean;        // auto-pause when button appears
}
```

### CreativeConfig

```typescript
interface CreativeConfig {
  width: number;              // creative width (default: 360)
  height: number;             // creative height (default: 640)
  posterFrameIndex: number;   // which frame to use as poster/thumbnail
  autoplayAfterTap: boolean;
  loopVideo: boolean;
  muteByDefault: boolean;     // required true for autoplay in browsers
  backgroundColor: string;    // CSS color (default: '#000000')
  clickThroughUrl: string;    // destination when CTA is tapped
  timeline: TimelineEvent[];
}
```

### FrameAnalysis

```typescript
interface FrameAnalysis {
  frameIndex: number;
  timestamp: number;
  thumbnailKey: string;
  sceneType: SceneType;         // gameplay|action|cutscene|title|menu|landscape|character
  description: string;          // model's chain-of-thought description
  mood: Mood;                   // intense|calm|dramatic|exciting|mysterious|epic
  importance: number;           // 1-10 (≥7 required for isAction=true)
  isAction: boolean;
  actionType: string;           // attack|dodge|jump|shoot|spell|none
  actionLabel: string;          // button text (e.g. "Heavy Strike!")
  cta: CTAButton;
  overlay: OverlayElement;
  animationSuggestion: AnimationType;
}
```

---

## 12. Cloudflare Bindings & Config

**File:** `wrangler.toml`

```toml
name = "vid2creative"
main = "src/worker/index.ts"
compatibility_date = "2026-03-01"
compatibility_flags = ["nodejs_compat"]

[ai]
binding = "AI"

[[kv_namespaces]]
binding = "KV"
id = "9e2f03c38f2d443e978dd24fc7a678d2"

[[r2_buckets]]
binding = "R2"
bucket_name = "vid2creative-assets"

[assets]
directory = "./dist"
```

### KV Keys

| Key pattern | Content | TTL |
|---|---|---|
| `session:{sessionId}` | JSON session object | 24h |
| `frame:{sessionId}:{frameIndex}` | JSON FrameAnalysis | 24h |
| `daily_neurons:{YYYY-MM-DD}` | integer usage counter | Auto-expires |
| `meta:model_agreed` | `'true'` warmup flag | Persistent |

### R2 Key Patterns

| Key pattern | Content |
|---|---|
| `videos/{sessionId}.mp4` | Original uploaded video |
| `frames/{sessionId}/{frameIndex}.jpg` | Analyzed frame thumbnails |

---

## 13. Known Issues & Limitations

### ISSUE-01 — AI Only Finds 1 Action Button (Active Bug)

**Symptom:** AI analyzes 10 frames, exported creative has only 1 button.

**Root cause:** Two strict rules in `vision.ts:parseAnalysisResponse()` combine to reject most frames:
1. `importance < 7` → forces `isAction = false`
2. Description contains "running/walking" → forces `isAction = false`

Gameplay videos have mostly running/moving frames even in combat sections. The model's chain-of-thought often describes "character running toward enemy" which triggers rule 2.

**Current behavior of fallback:** `selectBestActions()` only uses the motion-score fallback when AI finds **zero** actions. If AI finds 1 action, no fallback fires — the creative gets 1 button instead of 4.

**Fix needed:** Supplement AI-confirmed actions with high-motion frames when AI finds fewer than `maxCount` actions:
```typescript
// After finding AI-confirmed actions, if selected.length < maxCount,
// fill remaining slots from high-motion frames (enforcing MIN_ACTION_GAP)
```

### ISSUE-02 — Poster Frame Collision Silently Drops Timeline Event

If a timeline event's `frameIndex === config.posterFrameIndex`, the event is shown on the poster overlay but NOT in the video timeline. The user sees it in the editor but it disappears from playback in the exported creative.

**Fix:** In ExportPanel, warn when any timeline event has `frameIndex === config.posterFrameIndex`.

### ISSUE-03 — Button Pre-offset is Hardcoded

The 2.5s pre-offset (AI-selected) and 1.5s (manual "Add Action Here") are hardcoded. Fast-paced games with sub-second animations may need a smaller offset.

**Improvement:** Expose per-event "appear before" offset in OverlayEditor.

### ISSUE-04 — Daily Neuron Limit is Shared Across All Users

10,000 neurons/day shared globally. One heavy user can block everyone else. No per-session or per-user budget enforcement.

### ISSUE-05 — Frame Extraction Blocks Main Thread

`extractFrames()` runs in the main thread using sequential `await` canvas operations. Videos over 60s at 1s intervals can freeze the UI. Should be moved to a Web Worker with `postMessage` progress updates.

---

## 14. Deployment Commands

```bash
# Install dependencies
npm install

# Local development (full stack — Worker + frontend)
npx wrangler dev         # Serves at localhost:8787

# Build frontend only
npm run build            # Vite → ./dist

# Deploy to Cloudflare Workers (production)
npx wrangler deploy      # Builds frontend, deploys Worker + static assets

# Tail production logs (real-time)
npx wrangler tail

# Create KV namespace (first-time setup)
npx wrangler kv:namespace create "KV"
# → Copy the id into wrangler.toml [[kv_namespaces]]

# Create R2 bucket (first-time setup)
npx wrangler r2 bucket create vid2creative-assets

# List R2 objects
npx wrangler r2 object list vid2creative-assets

# Check today's neuron usage
npx wrangler kv:key get --binding=KV "daily_neurons:$(date +%Y-%m-%d)"

# Clear neuron counter (reset daily limit)
npx wrangler kv:key delete --binding=KV "daily_neurons:$(date +%Y-%m-%d)"
```

---

*This document reflects the codebase at v1.2.0. Update this file when: adding new Worker routes, changing the AI prompt, modifying the export HTML format, or adding new frontend steps.*
