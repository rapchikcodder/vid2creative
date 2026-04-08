import React, { useState, useRef, useCallback, useEffect } from 'react';
import { uploadVideo, detectActions, analyzeFrame } from '../lib/api';
import type { Session, ExtractedFrame, FrameAnalysis, OverlayElement, AnimationType, ScoredFrame, ActionCluster, DetectActionsResponse } from '../lib/types';

const MAX_ACTIONS = 6;
const AI_CANDIDATES = 4;
const AI_CALL_DELAY_MS = 13000;
const MIN_ACTION_GAP = 2.0;
const DIFF_SIZE = 64;
const DEFAULT_SENSITIVITY = 0.45;

interface Props {
  session: Session;
  videoFile: File;
  onComplete: (frames: ExtractedFrame[], focusX?: number) => void;
}

type Phase = 'idle' | 'extracting' | 'ml-running' | 'done' | 'error';

const DEFAULT_OVERLAY: OverlayElement = { type: 'none', text: '', position: 'top-right', visible: false };

/**
 * Smart frame selection: cap + gap + temporal diversity.
 * Divides video into 3 segments and ensures picks from each segment.
 * Returns the set of frame indices to select.
 */
function selectTopActions(
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

  // Segment candidates into thirds of the video
  const segments = [
    candidates.filter(s => s.timestamp < segSize),
    candidates.filter(s => s.timestamp >= segSize && s.timestamp < segSize * 2),
    candidates.filter(s => s.timestamp >= segSize * 2),
  ];

  // Pick best from each non-empty segment first (temporal diversity)
  const selected: ScoredFrame[] = [];
  for (const seg of segments) {
    if (seg.length === 0 || selected.length >= maxActions) continue;
    selected.push(seg[0]);
  }

  // Fill remaining slots from all candidates with gap enforcement
  for (const c of candidates) {
    if (selected.length >= maxActions) break;
    if (selected.some(s => s.index === c.index)) continue;
    const tooClose = selected.some(s => Math.abs(s.timestamp - c.timestamp) < minGap);
    if (!tooClose) selected.push(c);
  }

  return new Set(selected.map(s => s.index));
}

function computeMotionScore(
  ctx: CanvasRenderingContext2D,
  prevData: Uint8ClampedArray | null,
  fullCanvas: HTMLCanvasElement,
): { score: number; pixelData: Uint8ClampedArray } {
  ctx.drawImage(fullCanvas, 0, 0, DIFF_SIZE, DIFF_SIZE);
  const img = ctx.getImageData(0, 0, DIFF_SIZE, DIFF_SIZE);
  const data = img.data;
  if (!prevData) return { score: 0, pixelData: data };
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = Math.abs(data[i] - prevData[i]);
    const g = Math.abs(data[i + 1] - prevData[i + 1]);
    const b = Math.abs(data[i + 2] - prevData[i + 2]);
    total += (r + g + b) / 3;
  }
  return { score: total / (DIFF_SIZE * DIFF_SIZE * 255), pixelData: data };
}

export default function FrameExtractor({ session, videoFile, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inspected, setInspected] = useState<ExtractedFrame | null>(null);
  const [intervalSec, setIntervalSec] = useState(1.0);
  const [runAI, setRunAI] = useState(false);
  const [neurons, setNeurons] = useState<{ dailyTotal: number; dailyLimit: number } | null>(null);
  const [aiStatus, setAiStatus] = useState<'idle' | 'running' | 'done'>('idle');

  // ML state
  const [mlStatus, setMlStatus] = useState<'idle' | 'uploading' | 'detecting' | 'done' | 'error'>('idle');
  const [mlScores, setMlScores] = useState<ScoredFrame[] | null>(null);
  const [mlClusters, setMlClusters] = useState<ActionCluster[] | null>(null);
  const [sensitivity, setSensitivity] = useState(DEFAULT_SENSITIVITY);
  const [mlError, setMlError] = useState<string | null>(null);
  const [mlFocusX, setMlFocusX] = useState<number | undefined>(undefined);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<ExtractedFrame[]>([]);

  const maxScore = frames.reduce((m, f) => Math.max(m, f.motionScore ?? 0), 0.001);

  // Re-apply action markers when sensitivity changes — uses smart selection with cap + gap + temporal diversity
  useEffect(() => {
    if (!mlScores || framesRef.current.length === 0) return;
    const pickSet = selectTopActions(framesRef.current, mlScores, sensitivity, MAX_ACTIONS, MIN_ACTION_GAP);
    const updated = framesRef.current.map(f => {
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
    setFrames(updated);
  }, [sensitivity, mlScores]);

  // Background ML pipeline: upload → detect
  const runMLPipeline = useCallback(async () => {
    setMlStatus('uploading');
    setMlError(null);
    try {
      // Upload video to R2
      const uploadResult = await uploadVideo(videoFile);
      setMlStatus('detecting');
      // Call ML action detection
      const result: DetectActionsResponse = await detectActions(
        uploadResult.sessionId,
        intervalSec,
        sensitivity,
      );
      setMlScores(result.allScores);
      setMlClusters(result.actionClusters);
      setMlFocusX(result.focusX);
      setMlStatus('done');

      // Merge ML results onto existing frames with smart selection (cap + gap + temporal diversity)
      const currentFrames = framesRef.current;

      // First, map ML scores to browser frame indices by closest timestamp
      const mappedScores: ScoredFrame[] = result.allScores.map(s => {
        const closest = currentFrames.reduce((best, f) =>
          Math.abs(f.timestamp - s.timestamp) < Math.abs(best.timestamp - s.timestamp) ? f : best,
          currentFrames[0],
        );
        return { ...s, index: closest.index, timestamp: closest.timestamp };
      }).filter((s, i, arr) => {
        // Deduplicate: keep only the best score per browser frame index
        const bestForIdx = arr.filter(x => x.index === s.index).sort((a, b) => b.cv_confidence - a.cv_confidence)[0];
        return s === bestForIdx;
      });

      const pickSet = selectTopActions(currentFrames, mappedScores, sensitivity, MAX_ACTIONS, MIN_ACTION_GAP);

      const updated = currentFrames.map(f => {
        const mlFrame = mappedScores.find(s => s.index === f.index);
        const isAction = pickSet.has(f.index);
        return {
          ...f,
          motionScore: mlFrame ? mlFrame.motion_score : f.motionScore,
          isSelected: isAction,
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
      framesRef.current = updated;
      setFrames(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ML detection failed';
      setMlError(msg);
      setMlStatus('error');
    }
  }, [videoFile, intervalSec, sensitivity]);

  async function startExtraction() {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.preload = 'auto';
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Video load failed'));
    });
    const duration = video.duration;
    const timestamps: number[] = [];
    for (let t = 0; t < duration; t += intervalSec) timestamps.push(t);

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const diffCanvas = diffCanvasRef.current!;
    const diffCtx = diffCanvas.getContext('2d', { willReadFrequently: true })!;
    canvas.width = 640;
    canvas.height = Math.round(640 * (video.videoHeight / video.videoWidth));
    diffCanvas.width = DIFF_SIZE;
    diffCanvas.height = DIFF_SIZE;

    setPhase('extracting');
    const extracted: ExtractedFrame[] = [];
    let prevData: Uint8ClampedArray | null = null;

    for (let i = 0; i < timestamps.length; i++) {
      setProgress(Math.round((i / timestamps.length) * 100));
      setStatusMsg(`Extracting frame ${i + 1} / ${timestamps.length}`);
      video.currentTime = timestamps[i];
      await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { score, pixelData } = computeMotionScore(diffCtx, prevData, canvas);
      prevData = pixelData;
      const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.8));
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });
      extracted.push({
        index: i, timestamp: timestamps[i], blob, base64,
        thumbnailUrl: URL.createObjectURL(blob),
        analysisStatus: 'pending', motionScore: score,
      });
    }
    URL.revokeObjectURL(video.src);
    framesRef.current = extracted;
    setFrames([...extracted]);

    // Browser extraction done — smart action frame selection using motion spikes
    // Instead of raw motion threshold, detect sudden CHANGES (spikes) in motion
    const scores = extracted.map(f => f.motionScore ?? 0);
    const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
    const variance = scores.reduce((a, s) => a + (s - mean) ** 2, 0) / (scores.length || 1);
    const stddev = Math.sqrt(variance);
    // Dynamic threshold: frames must be above mean + 0.5*stddev (adapts to video)
    const dynamicThreshold = Math.max(mean + 0.5 * stddev, 0.12);

    // Also compute motion acceleration (change between frames) to find spikes
    const accel = scores.map((s, i) => i === 0 ? 0 : Math.max(0, s - scores[i - 1]));
    const accelMean = accel.reduce((a, b) => a + b, 0) / (accel.length || 1);
    const accelStd = Math.sqrt(accel.reduce((a, s) => a + (s - accelMean) ** 2, 0) / (accel.length || 1));

    // Score = weighted combo: 60% raw motion above threshold + 40% spike magnitude
    const ranked = extracted.map((f, i) => {
      const motionAbove = Math.max(0, (f.motionScore ?? 0) - dynamicThreshold);
      const spikeScore = accel[i] > accelMean + accelStd ? accel[i] : 0;
      return { frame: f, rank: motionAbove * 0.6 + spikeScore * 0.4 };
    }).filter(r => r.rank > 0).sort((a, b) => b.rank - a.rank);

    const initialPicks: ExtractedFrame[] = [];
    for (const { frame } of ranked) {
      if (initialPicks.length >= MAX_ACTIONS) break;
      const tooClose = initialPicks.some(s => Math.abs(s.timestamp - frame.timestamp) < MIN_ACTION_GAP);
      if (!tooClose) initialPicks.push(frame);
    }
    const pickSet = new Set(initialPicks.map(f => f.index));
    const withSelection = extracted.map(f => ({
      ...f,
      isSelected: pickSet.has(f.index),
      refinedTimestamp: Math.max(0, f.timestamp - 2.5),
    }));
    framesRef.current = withSelection;
    setFrames(withSelection);
    setProgress(100);
    setPhase('ml-running');
    setStatusMsg('Frames ready! Running ML detection in background…');

    // Fire ML pipeline in background
    runMLPipeline();

    // If AI enabled, also run vision AI on top candidates
    if (runAI) {
      runAIAnalysis(withSelection);
    }
  }

  async function runAIAnalysis(allFrames: ExtractedFrame[]) {
    setAiStatus('running');
    // Pick top motion frames for AI
    const sorted = [...allFrames].sort((a, b) => (b.motionScore ?? 0) - (a.motionScore ?? 0));
    const candidates: ExtractedFrame[] = [];
    for (const f of sorted) {
      if (candidates.length >= AI_CANDIDATES) break;
      const tooClose = candidates.some(s => Math.abs(s.timestamp - f.timestamp) < MIN_ACTION_GAP);
      if (!tooClose) candidates.push(f);
    }

    const updated = [...allFrames];
    for (let i = 0; i < candidates.length; i++) {
      const f = candidates[i];
      setStatusMsg(`AI analyzing frame ${i + 1} / ${candidates.length}${i > 0 ? ' (pacing…)' : '…'}`);
      if (i > 0) await new Promise(r => setTimeout(r, AI_CALL_DELAY_MS));
      updated[f.index] = { ...updated[f.index], analysisStatus: 'analyzing' };
      setFrames([...updated]);
      try {
        const result = await analyzeFrame({
          sessionId: session.id, frameIndex: f.index,
          timestamp: f.timestamp, imageBase64: f.base64,
        });
        setNeurons(result.neurons);
        updated[f.index] = { ...updated[f.index], analysisStatus: 'done', analysis: result.analysis };
      } catch {
        updated[f.index] = { ...updated[f.index], analysisStatus: 'error' };
      }
      framesRef.current = [...updated];
      setFrames([...updated]);
    }
    setAiStatus('done');
  }

  async function handleStart() {
    setError(null);
    try {
      await startExtraction();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
      setPhase('error');
    }
  }

  function toggleFrame(index: number) {
    const updated = frames.map(f =>
      f.index === index ? { ...f, isSelected: !f.isSelected } : f,
    );
    framesRef.current = updated;
    setFrames(updated);
  }

  function handleContinue() {
    const selected = frames.filter(f => f.isSelected).map(f => ({
      ...f,
      refinedTimestamp: Math.max(0, f.timestamp - 2.5),
    }));
    if (selected.length === 0) {
      setError('Select at least one action frame to continue');
      return;
    }
    onComplete(frames, mlFocusX);
  }

  const isExtracting = phase === 'extracting';
  const selectedCount = frames.filter(f => f.isSelected).length;
  const actionCount = mlScores ? mlScores.filter(s => s.cv_confidence >= sensitivity).length : 0;

  return (
    <div className="flex flex-col h-[calc(100vh-73px)]">
      <div className="flex-1 flex flex-col gap-4 p-6 overflow-auto">
        {phase === 'idle' && (
          <div className="max-w-xl mx-auto w-full">
            <h2 className="text-xl font-semibold mb-4">Action Detection Settings</h2>
            <div className="bg-gray-900 rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between cursor-pointer" onClick={() => setRunAI(v => !v)}>
                <div>
                  <p className="font-medium">AI frame analysis</p>
                  <p className="text-sm text-gray-400">Vision AI picks the best action moments. ~{AI_CANDIDATES * (AI_CALL_DELAY_MS / 1000)}s extra. Uses neurons.</p>
                </div>
                <div className={`relative w-11 h-6 rounded-full transition-colors ${runAI ? 'bg-indigo-600' : 'bg-gray-600'}`}>
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${runAI ? 'translate-x-5' : ''}`} />
                </div>
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Frame interval (seconds)</label>
                <input type="number" min={0.5} max={5} step={0.5} value={intervalSec}
                  onChange={e => setIntervalSec(parseFloat(e.target.value))}
                  className="w-24 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm" />
              </div>
              <p className="text-sm text-gray-500">
                Frames are extracted instantly in your browser. ML action detection (optical flow + scene detection) runs in background — no AI neurons.
                {runAI ? ' AI vision analysis will also run on top candidates.' : ''}
              </p>
              <button onClick={handleStart}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-lg transition-colors">
                Start detection
              </button>
            </div>
          </div>
        )}

        {isExtracting && (
          <div className="max-w-xl mx-auto w-full">
            <div className="bg-gray-900 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <p className="text-gray-300">{statusMsg}</p>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-gray-500 text-sm mt-2 text-right">{progress}%</p>
            </div>
          </div>
        )}

        {phase === 'error' && error && (
          <div className="max-w-xl mx-auto w-full bg-red-950 border border-red-800 rounded-xl p-5">
            <p className="text-red-300 mb-3">{error}</p>
            <button onClick={() => { setPhase('idle'); setError(null); }} className="text-sm text-red-400 underline">Try again</button>
          </div>
        )}

        {/* Frame grid — visible as soon as extraction starts producing frames */}
        {frames.length > 0 && (
          <>
            {/* ML status banner */}
            {(phase === 'ml-running' || phase === 'done') && (
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  {mlStatus === 'uploading' && (
                    <>
                      <div className="w-4 h-4 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-yellow-400">Uploading video for ML analysis…</span>
                    </>
                  )}
                  {mlStatus === 'detecting' && (
                    <>
                      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-blue-400">Running ML detection (optical flow + scene detection)…</span>
                    </>
                  )}
                  {mlStatus === 'done' && (
                    <span className="text-sm text-green-400">ML detection complete — {actionCount} action frames found</span>
                  )}
                  {mlStatus === 'error' && (
                    <span className="text-sm text-red-400">ML detection failed: {mlError}. Using browser motion scores.</span>
                  )}
                  {mlStatus === 'idle' && (
                    <span className="text-sm text-gray-400">Browser motion detection active</span>
                  )}
                </div>
              </div>
            )}

            {/* Sensitivity slider (only when ML scores available) */}
            {mlScores && (
              <div className="bg-gray-900 rounded-lg p-4 flex items-center gap-4">
                <label className="text-sm text-gray-400 whitespace-nowrap">Sensitivity</label>
                <input
                  type="range" min={0.1} max={0.8} step={0.05}
                  value={sensitivity}
                  onChange={e => setSensitivity(parseFloat(e.target.value))}
                  className="flex-1 accent-indigo-500"
                />
                <span className="text-sm text-gray-300 w-12 text-right">{(sensitivity * 100).toFixed(0)}%</span>
                <span className="text-xs text-gray-500">{actionCount} actions</span>
              </div>
            )}

            {/* AI status banner */}
            {aiStatus === 'running' && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-purple-400">{statusMsg}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-300">
                {frames.length} frames &middot; {selectedCount} selected
                {neurons && (
                  <span className={`ml-3 text-xs px-2 py-0.5 rounded ${neurons.dailyTotal >= 4000 ? 'bg-yellow-900 text-yellow-300' : 'bg-gray-800 text-gray-400'}`}>
                    {neurons.dailyTotal} / {neurons.dailyLimit} neurons
                  </span>
                )}
              </h3>
              {selectedCount > 0 && (phase === 'ml-running' || phase === 'done') && (
                <button onClick={handleContinue}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-5 py-2 rounded-lg transition-colors text-sm">
                  Continue with {selectedCount} frames &rarr;
                </button>
              )}
            </div>

            <div className="grid grid-cols-5 sm:grid-cols-8 lg:grid-cols-10 gap-2">
              {frames.map(f => {
                const mlFrame = mlScores?.find(s => s.index === f.index);
                const cvConf = mlFrame?.cv_confidence;
                return (
                  <div key={f.index}
                    className={`relative cursor-pointer rounded overflow-hidden border-2 transition-all
                      ${f.isSelected ? 'border-green-400 ring-1 ring-green-400/30' : mlScores ? 'border-transparent opacity-50 hover:opacity-80' : 'border-transparent hover:border-gray-600'}`}
                    onClick={() => toggleFrame(f.index)}>
                    {f.thumbnailUrl ? (
                      <img src={f.thumbnailUrl} alt={`Frame ${f.index}`} className="w-full aspect-video object-cover" />
                    ) : (
                      <div className="w-full aspect-video bg-gray-800 flex items-center justify-center text-xs text-gray-500">
                        {f.timestamp.toFixed(1)}s
                      </div>
                    )}
                    {/* Motion bar */}
                    <div className="absolute bottom-0 left-0 right-0 h-1">
                      <div className={`h-full ${(f.motionScore ?? 0) >= 0.08 ? 'bg-orange-500' : 'bg-gray-700'}`}
                        style={{ width: `${((f.motionScore ?? 0) / maxScore) * 100}%` }} />
                    </div>
                    {/* AI analyzing spinner */}
                    {f.analysisStatus === 'analyzing' && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <div className="w-4 h-4 border border-purple-400 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                    {/* AI action dot */}
                    {f.analysis?.isAction && <div className="absolute top-0.5 right-0.5 w-2.5 h-2.5 bg-purple-400 rounded-full border border-purple-600" />}
                    {/* CV confidence badge */}
                    {cvConf !== undefined && cvConf >= sensitivity && !f.analysis?.isAction && (
                      <div className="absolute top-0.5 right-0.5 text-[8px] bg-green-600 text-white rounded px-1 font-bold">
                        {(cvConf * 100).toFixed(0)}%
                      </div>
                    )}
                    {/* Selected checkmark */}
                    {f.isSelected && (
                      <div className="absolute top-0.5 left-0.5 text-[9px] bg-indigo-600 rounded px-0.5">&#x2713;</div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Frame inspector modal */}
        {inspected && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6" onClick={() => setInspected(null)}>
            <div className="bg-gray-900 rounded-2xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold">Frame {inspected.index} &middot; {inspected.timestamp.toFixed(2)}s</p>
                <button onClick={() => setInspected(null)} className="text-gray-500 hover:text-white">&#x2715;</button>
              </div>
              {inspected.thumbnailUrl && <img src={inspected.thumbnailUrl} alt="frame" className="w-full rounded-lg mb-3" />}
              {(() => {
                const mlFrame = mlScores?.find(s => s.index === inspected.index);
                return mlFrame ? (
                  <div className="text-sm space-y-1 text-gray-300">
                    <p><span className="text-gray-500">Combined Score:</span> {(mlFrame.cv_confidence * 100).toFixed(1)}%</p>
                    <p><span className="text-gray-500">Visual Score:</span> <span className={mlFrame.clip_score >= 0.6 ? 'text-green-400' : mlFrame.clip_score >= 0.4 ? 'text-yellow-400' : 'text-red-400'}>{(mlFrame.clip_score * 100).toFixed(1)}%</span></p>
                    <p><span className="text-gray-500">Motion:</span> {(mlFrame.motion_score * 100).toFixed(1)}%</p>
                    <p><span className="text-gray-500">Scene Proximity:</span> {(mlFrame.scene_proximity_score * 100).toFixed(1)}%</p>
                    <p><span className="text-gray-500">Motion Spike:</span> {(mlFrame.motion_spike_score * 100).toFixed(1)}%</p>
                    <p><span className="text-gray-500">Scene Boundary:</span> {mlFrame.near_scene_boundary ? `yes (${mlFrame.scene_type})` : 'no'}</p>
                    <p><span className="text-gray-500">Is Action:</span> {mlFrame.cv_confidence >= sensitivity ? 'yes' : 'no'}</p>
                  </div>
                ) : (
                  <div className="text-sm space-y-1 text-gray-300">
                    <p><span className="text-gray-500">Motion:</span> {((inspected.motionScore ?? 0) * 100).toFixed(1)}%</p>
                    <p className="text-gray-500 text-xs">ML scores not yet available</p>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={diffCanvasRef} className="hidden" />
    </div>
  );
}
