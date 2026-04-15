import { useState, useCallback } from 'react';
import { uploadVideo, detectActions } from '../lib/api';
import type { ExtractedFrame, ScoredFrame, ActionCluster, DetectActionsResponse, OverlayElement, AnimationType } from '../lib/types';

const MAX_ACTIONS = 6;
const MIN_ACTION_GAP = 2.0;
const DEFAULT_OVERLAY: OverlayElement = { type: 'none', text: '', position: 'top-right', visible: false };

export function selectTopActions(
  allFrames: { index: number; timestamp: number }[],
  scores: ScoredFrame[],
  threshold: number,
  maxActions: number,
  minGap: number,
): Set<number> {
  const candidates = scores
    .filter(s => s.cv_confidence >= threshold)
    .sort((a, b) => b.cv_confidence - a.cv_confidence);
  if (candidates.length === 0) return new Set();

  const maxTs = Math.max(...allFrames.map(f => f.timestamp), 1);
  const segSize = maxTs / 3;

  const segments = [
    candidates.filter(s => s.timestamp < segSize),
    candidates.filter(s => s.timestamp >= segSize && s.timestamp < segSize * 2),
    candidates.filter(s => s.timestamp >= segSize * 2),
  ];

  const selected: ScoredFrame[] = [];
  for (const seg of segments) {
    if (seg.length === 0 || selected.length >= maxActions) continue;
    selected.push(seg[0]);
  }

  for (const c of candidates) {
    if (selected.length >= maxActions) break;
    if (selected.some(s => s.index === c.index)) continue;
    const tooClose = selected.some(s => Math.abs(s.timestamp - c.timestamp) < minGap);
    if (!tooClose) selected.push(c);
  }

  return new Set(selected.map(s => s.index));
}

export function mergeMLResults(
  currentFrames: ExtractedFrame[],
  mlScores: ScoredFrame[],
  sensitivity: number,
): ExtractedFrame[] {
  const pickSet = selectTopActions(currentFrames, mlScores, sensitivity, MAX_ACTIONS, MIN_ACTION_GAP);
  return currentFrames.map(f => {
    const mlFrame = mlScores.find(s => s.index === f.index);
    const isAction = pickSet.has(f.index);
    return {
      ...f,
      isSelected: isAction,
      motionScore: mlFrame ? mlFrame.motion_score : f.motionScore,
      analysis: isAction && mlFrame ? {
        frameIndex: f.index,
        timestamp: f.timestamp,
        thumbnailKey: '',
        sceneType: 'action' as const,
        description: `CV confidence: ${(mlFrame.cv_confidence * 100).toFixed(0)}%`,
        mood: 'intense' as const,
        importance: Math.round(mlFrame.cv_confidence * 10),
        isAction: true,
        actionType: mlFrame.near_scene_boundary ? 'scene_change' : 'high_motion',
        actionLabel: mlFrame.scene_type !== 'none' ? mlFrame.scene_type : 'action',
        cta: { text: 'Play Now', position: { x: 50, y: 80 }, style: 'primary' as const, size: 'medium' as const, visible: true, action: 'link' as const },
        overlay: DEFAULT_OVERLAY,
        animationSuggestion: 'fade-in' as AnimationType,
      } : undefined,
      analysisStatus: 'done' as const,
    };
  });
}

interface UseMLPipelineReturn {
  mlStatus: 'idle' | 'uploading' | 'detecting' | 'done' | 'error';
  mlScores: ScoredFrame[] | null;
  mlClusters: ActionCluster[] | null;
  mlError: string | null;
  mlFocusX: number | undefined;
  runMLPipeline: (
    videoFile: File,
    intervalSec: number,
    sensitivity: number,
    currentFrames: ExtractedFrame[],
    onFramesUpdated: (frames: ExtractedFrame[]) => void,
  ) => Promise<void>;
}

export function useMLPipeline(): UseMLPipelineReturn {
  const [mlStatus, setMlStatus] = useState<'idle' | 'uploading' | 'detecting' | 'done' | 'error'>('idle');
  const [mlScores, setMlScores] = useState<ScoredFrame[] | null>(null);
  const [mlClusters, setMlClusters] = useState<ActionCluster[] | null>(null);
  const [mlError, setMlError] = useState<string | null>(null);
  const [mlFocusX, setMlFocusX] = useState<number | undefined>(undefined);

  const runMLPipeline = useCallback(async (
    videoFile: File,
    intervalSec: number,
    sensitivity: number,
    currentFrames: ExtractedFrame[],
    onFramesUpdated: (frames: ExtractedFrame[]) => void,
  ) => {
    setMlStatus('uploading');
    setMlError(null);
    try {
      const uploadResult = await uploadVideo(videoFile);
      setMlStatus('detecting');
      const result: DetectActionsResponse = await detectActions(
        uploadResult.sessionId,
        intervalSec,
        sensitivity,
      );
      setMlClusters(result.actionClusters);
      setMlFocusX(result.focusX);
      setMlStatus('done');

      // Map ML scores to browser frame indices by closest timestamp
      const mappedScores: ScoredFrame[] = result.allScores.map(s => {
        const closest = currentFrames.reduce((best, f) =>
          Math.abs(f.timestamp - s.timestamp) < Math.abs(best.timestamp - s.timestamp) ? f : best,
          currentFrames[0],
        );
        return { ...s, index: closest.index, timestamp: closest.timestamp };
      }).filter((s, i, arr) => {
        const bestForIdx = arr.filter(x => x.index === s.index).sort((a, b) => b.cv_confidence - a.cv_confidence)[0];
        return s === bestForIdx;
      });

      setMlScores(mappedScores);
      const updated = mergeMLResults(currentFrames, mappedScores, sensitivity);
      onFramesUpdated(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ML detection failed';
      setMlError(msg);
      setMlStatus('error');
    }
  }, []);

  return { mlStatus, mlScores, mlClusters, mlError, mlFocusX, runMLPipeline };
}
