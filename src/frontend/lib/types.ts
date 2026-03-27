export type SceneType =
  | 'gameplay' | 'cutscene' | 'title' | 'menu' | 'action'
  | 'landscape' | 'character' | 'logo' | 'product' | 'text' | 'unknown';

export type Mood = 'intense' | 'calm' | 'dramatic' | 'exciting' | 'mysterious' | 'epic';

export type ButtonAction = 'link' | 'play' | 'pause' | 'replay' | 'mute_toggle';

export type ButtonStyle =
  | 'primary' | 'secondary' | 'floating' | 'pulse'
  | 'glow' | 'slide-in' | 'bounce' | 'glass';

export type AnimationType =
  | 'fade-in' | 'slide-up' | 'slide-left' | 'slide-right'
  | 'zoom-in' | 'bounce' | 'pulse' | 'glow' | 'shake';

export interface CTAButton {
  text: string;
  position: { x: number; y: number };
  style: ButtonStyle;
  size: 'small' | 'medium' | 'large';
  visible: boolean;
  action: ButtonAction;
}

export interface OverlayElement {
  type: 'none' | 'progress_bar' | 'score_display' | 'timer' | 'badge' | 'ribbon' | 'logo';
  text: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  visible: boolean;
}

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

export interface ExtractedFrame {
  index: number;
  timestamp: number;
  blob: Blob;
  base64: string;
  thumbnailUrl: string;
  analysis?: FrameAnalysis;
  analysisStatus: 'pending' | 'analyzing' | 'done' | 'error';
  refinedTimestamp?: number;
  isSelected?: boolean;
  motionScore?: number;
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

// v2.0 — returned by POST /api/process (server-side CV pipeline)
export interface AnalyzedCandidate {
  index: number;
  timestamp: number;
  motion_score: number;
  near_scene_boundary: boolean;
  scene_type: string;
  cv_confidence: number;
  isAction: boolean;
  actionType: string;
  actionLabel: string;
  importance: number;
  mood: string;
  cta: CTAButton;
  animationSuggestion: AnimationType;
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
