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

// ---------------------------------------------------------------------------
// Layer system (v3.0)
// ---------------------------------------------------------------------------

export type LayerType = 'image' | 'text' | 'tutorial' | 'progress' | 'effect' | 'shape';

export interface TextLayerData {
  kind: 'text';
  text: string;
  fontSize: number;
  fontColor: string;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  textAlign: 'left' | 'center' | 'right';
  backgroundColor?: string;
}

export interface ImageLayerData {
  kind: 'image';
  src: string;
  alt?: string;
  objectFit: 'contain' | 'cover' | 'fill';
}

export interface TutorialLayerData {
  kind: 'tutorial';
  assetId: string;
  assetUrl: string;
}

export interface ProgressLayerData {
  kind: 'progress';
  barType: 'linear' | 'circular';
  color: string;
  backgroundColor: string;
  fillPercent: number;
}

export interface EffectLayerData {
  kind: 'effect';
  assetId: string;
  assetUrl: string;
  loop: boolean;
}

export interface ShapeLayerData {
  kind: 'shape';
  shape: 'rectangle' | 'circle' | 'triangle';
  fillColor: string;
  borderColor?: string;
  borderWidth: number;
  borderRadius?: number;
}

export type LayerData =
  | TextLayerData
  | ImageLayerData
  | TutorialLayerData
  | ProgressLayerData
  | EffectLayerData
  | ShapeLayerData;

export interface Layer {
  id: string;
  type: LayerType;
  name: string;
  visible: boolean;
  locked: boolean;
  position: { x: number; y: number };      // % of creative width/height
  size: { width: number; height: number }; // % of creative width/height
  rotation: number;
  opacity: number;
  zIndex: number;
  showAt?: number;    // timestamp in seconds — undefined = always visible
  hideAt?: number;
  animation?: AnimationType;
  data: LayerData;
}

// ---------------------------------------------------------------------------

export interface StartScreen {
  enabled: boolean;
  backgroundColor: string;
  backgroundGradient?: string;  // CSS gradient e.g. "135deg, #6c5ce7, #a29bfe"
  logoSrc?: string;             // base64 data URL
  logoSize: number;             // 40–120px
  headline: string;
  subtext: string;
  ctaText: string;
  ctaStyle: ButtonStyle;
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
  layers: Layer[];
  focusX?: number;           // horizontal focus point (0-100%) from ML motion centroid
  videoUrl?: string;         // server-hosted URL set after upload, used by html-generator
  startScreen?: StartScreen;
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

// ML action detection types (no AI, pure CV)
export interface ScoredFrame {
  index: number;
  timestamp: number;
  motion_score: number;
  scene_proximity_score: number;
  motion_spike_score: number;
  temporal_score: number;
  cv_confidence: number;
  clip_score: number;
  near_scene_boundary: boolean;
  scene_type: string;
  is_action: boolean;
}

export interface ActionCluster {
  peak_index: number;
  peak_timestamp: number;
  peak_cv_confidence: number;
  start_timestamp: number;
  end_timestamp: number;
  frame_count: number;
  jpeg_base64: string;
}

export interface DetectActionsResponse {
  sessionId: string;
  totalFramesExtracted: number;
  sceneBoundaries: number;
  actionCount: number;
  actionClusters: ActionCluster[];
  allScores: ScoredFrame[];
  focusX: number;            // horizontal center of action (0-100%) for smart crop
  processingTimeMs: number;
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

