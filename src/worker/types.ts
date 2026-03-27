export interface Env {
  AI: Ai;
  KV: KVNamespace;
  R2: R2Bucket;
  CV_PIPELINE: DurableObjectNamespace;
}

// --- CV Pipeline types (returned from Container) ---
export interface CvCandidate {
  index: number;
  timestamp: number;
  motion_score: number;
  near_scene_boundary: boolean;
  scene_type: string;
  jpeg_base64: string;
  cv_confidence: number;
}

export interface CvProcessResponse {
  session_id: string;
  total_frames_extracted: number;
  scene_boundaries_found: number;
  candidates: CvCandidate[];
  processing_time_ms: number;
}

// Candidate with AI analysis added on top of CV metadata
export interface AnalyzedCandidate extends Omit<CvCandidate, 'jpeg_base64'> {
  isAction: boolean;
  actionType: string;
  actionLabel: string;
  importance: number;
  mood: string;
  cta: CTAButton;
  animationSuggestion: AnimationType;
}

export interface ProcessRequest {
  sessionId: string;
  maxCandidates?: number;
  interval?: number;
}

export interface ProcessResponse {
  sessionId: string;
  totalFramesExtracted: number;
  sceneBoundaries: number;
  candidates: AnalyzedCandidate[];
  timeline: TimelineEvent[];
  processingTimeMs: number;
  cvProcessingTimeMs: number;
  aiProcessingTimeMs: number;
}

// --- Session ---
export interface Session {
  id: string;
  createdAt: string;
  videoKey: string;
  videoUrl: string;
  totalFrames: number;
  analyzedFrames: number;
  status: 'uploading' | 'extracting' | 'analyzing' | 'ready' | 'error';
  error?: string;
  config: CreativeConfig;
}

// --- Frame Analysis ---
export interface FrameAnalysis {
  frameIndex: number;
  timestamp: number;
  thumbnailKey: string;
  sceneType: SceneType;
  description: string;
  mood: Mood;
  importance: number;
  isAction: boolean;
  actionType: string;
  actionLabel: string;
  cta: CTAButton;
  overlay: OverlayElement;
  animationSuggestion: AnimationType;
}

export type SceneType =
  | 'gameplay' | 'cutscene' | 'title' | 'menu' | 'action'
  | 'landscape' | 'character' | 'logo' | 'product' | 'text' | 'unknown';

export type Mood = 'intense' | 'calm' | 'dramatic' | 'exciting' | 'mysterious' | 'epic';

export type ButtonAction = 'link' | 'play' | 'pause' | 'replay' | 'mute_toggle';

export interface CTAButton {
  text: string;
  position: { x: number; y: number };
  style: ButtonStyle;
  size: 'small' | 'medium' | 'large';
  visible: boolean;
  action: ButtonAction;
}

export type ButtonStyle =
  | 'primary' | 'secondary' | 'floating' | 'pulse'
  | 'glow' | 'slide-in' | 'bounce' | 'glass';

export interface OverlayElement {
  type: 'none' | 'progress_bar' | 'score_display' | 'timer' | 'badge' | 'ribbon' | 'logo';
  text: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  visible: boolean;
}

export type AnimationType =
  | 'fade-in' | 'slide-up' | 'slide-left' | 'slide-right'
  | 'zoom-in' | 'bounce' | 'pulse' | 'glow' | 'shake';

// --- Creative Config ---
export interface CreativeConfig {
  width: number;
  height: number;
  posterFrameIndex: number;
  autoplayAfterTap: boolean;
  loopVideo: boolean;
  muteByDefault: boolean;
  backgroundColor: string;
  clickThroughUrl: string;
  timeline: TimelineEvent[];
}

export interface TimelineEvent {
  id: string;
  frameIndex: number;
  timestamp: number;
  duration: number;
  cta: CTAButton;
  overlay: OverlayElement;
  animation: AnimationType;
  pauseVideo: boolean;
}

// --- App Error ---
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400,
  ) {
    super(message);
  }
}
