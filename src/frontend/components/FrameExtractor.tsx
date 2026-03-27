import React, { useState, useRef } from 'react';
import { analyzeFrame, processVideo } from '../lib/api';
import type { Session, ExtractedFrame, FrameAnalysis, OverlayElement, AnimationType, ProcessResponse } from '../lib/types';

const MAX_ACTIONS = 4;
const AI_CANDIDATES = 4;           // keep under Workers AI vision rate limit (~5 RPM)
const AI_CALL_DELAY_MS = 13000;    // 13s between AI calls — 5 RPM limit = 12s minimum
const MIN_ACTION_GAP = 2;
const DIFF_SIZE = 64;
const MOTION_THRESHOLD = 0.08;

interface Props {
  session: Session;
  videoFile: File;
  onComplete: (frames: ExtractedFrame[]) => void;
}

type Phase = 'idle' | 'extracting' | 'detecting' | 'analyzing' | 'done' | 'error';

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

function selectHighMotionFrames(frames: ExtractedFrame[], maxCount: number): ExtractedFrame[] {
  if (frames.length <= maxCount) return frames;
  const segSize = frames.length / maxCount;
  const selected: ExtractedFrame[] = [];
  for (let i = 0; i < maxCount; i++) {
    const start = Math.floor(i * segSize);
    const end = Math.min(Math.floor((i + 1) * segSize), frames.length);
    const seg = frames.slice(start, end);
    const best = seg.reduce((a, b) => (a.motionScore ?? 0) >= (b.motionScore ?? 0) ? a : b);
    selected.push(best);
  }
  return selected;
}

function selectBestActions(frames: ExtractedFrame[], maxCount: number): ExtractedFrame[] {
  const actions = frames.filter(
    f => f.analysisStatus === 'done' && f.analysis?.isAction && (f.analysis?.importance ?? 0) >= 6,
  );
  actions.sort((a, b) => (b.analysis?.importance ?? 0) - (a.analysis?.importance ?? 0));
  const selected: ExtractedFrame[] = [];
  for (const f of actions) {
    if (selected.length >= maxCount) break;
    const tooClose = selected.some(s => Math.abs(s.timestamp - f.timestamp) < MIN_ACTION_GAP);
    if (!tooClose) selected.push(f);
  }
  if (selected.length < maxCount) {
    const used = new Set(selected.map(f => f.index));
    const byMotion = frames
      .filter(f => !used.has(f.index))
      .sort((a, b) => (b.motionScore ?? 0) - (a.motionScore ?? 0));
    for (const f of byMotion) {
      if (selected.length >= maxCount) break;
      const tooClose = selected.some(s => Math.abs(s.timestamp - f.timestamp) < MIN_ACTION_GAP);
      if (!tooClose) selected.push(f);
    }
  }
  return selected;
}

const DEFAULT_OVERLAY: OverlayElement = { type: 'none', text: '', position: 'top-right', visible: false };

export default function FrameExtractor({ session, videoFile, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inspected, setInspected] = useState<ExtractedFrame | null>(null);
  const [useServerCV, setUseServerCV] = useState(false);
  const [runAI, setRunAI] = useState(true);
  const [intervalSec, setIntervalSec] = useState(1.0);
  const [neurons, setNeurons] = useState<{ dailyTotal: number; dailyLimit: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement>(null);

  const maxScore = frames.reduce((m, f) => Math.max(m, f.motionScore ?? 0), 0.001);

  async function startServerCV() {
    setPhase('analyzing');
    setProgress(10);
    setStatusMsg('Sending video to server for CV + AI analysis…');
    try {
      const result: ProcessResponse = await processVideo(session.id, MAX_ACTIONS, intervalSec);
      const mapped: ExtractedFrame[] = result.candidates.map((c) => {
        const analysis: FrameAnalysis = {
          frameIndex: c.index,
          timestamp: c.timestamp,
          thumbnailKey: '',
          sceneType: 'gameplay',
          description: `motion=${c.motion_score.toFixed(2)}, cv_conf=${c.cv_confidence.toFixed(2)}`,
          mood: (c.mood ?? 'intense') as FrameAnalysis['mood'],
          importance: c.importance,
          isAction: c.isAction,
          actionType: c.actionType,
          actionLabel: c.actionLabel,
          cta: c.cta,
          overlay: DEFAULT_OVERLAY,
          animationSuggestion: c.animationSuggestion as AnimationType,
        };
        return {
          index: c.index,
          timestamp: c.timestamp,
          blob: new Blob(),
          base64: '',
          thumbnailUrl: '',
          analysis,
          analysisStatus: 'done' as const,
          refinedTimestamp: Math.max(0, c.timestamp - 2.5),
          isSelected: result.timeline.some(t => t.frameIndex === c.index),
          motionScore: c.motion_score,
        };
      });
      setFrames(mapped);
      setProgress(100);
      setPhase('done');
      onComplete(mapped);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Server CV failed';
      if (msg.includes('503') || msg.includes('CV_PIPELINE_UNREACHABLE')) {
        // Container beta not enabled — auto-fall back to client-side
        setUseServerCV(false);
        setPhase('idle');
        setStatusMsg('');
        setError('Server-side CV is not available yet (requires Containers beta). Switched to client-side analysis.');
        setPhase('error');
      } else {
        setError(msg);
        setPhase('error');
      }
    }
  }

  async function startClientExtraction() {
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
      setProgress(Math.round((i / timestamps.length) * 50));
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
    setFrames([...extracted]);

    setPhase('detecting');
    setStatusMsg('Selecting candidates…');
    const allFrames = [...extracted];

    if (runAI) {
      const candidates = selectHighMotionFrames(extracted, AI_CANDIDATES);
      setPhase('analyzing');

      for (let i = 0; i < candidates.length; i++) {
        const f = candidates[i];
        setProgress(50 + Math.round((i / candidates.length) * 50));
        setStatusMsg(`Analyzing frame ${i + 1} / ${candidates.length} with AI${i > 0 ? ' (pacing to avoid rate limit…)' : '…'}`);
        if (i > 0) await new Promise(r => setTimeout(r, AI_CALL_DELAY_MS));
        allFrames[f.index] = { ...f, analysisStatus: 'analyzing' };
        setFrames([...allFrames]);
        try {
          const result = await analyzeFrame({
            sessionId: session.id, frameIndex: f.index,
            timestamp: f.timestamp, imageBase64: f.base64,
          });
          setNeurons(result.neurons);
          allFrames[f.index] = { ...f, analysisStatus: 'done', analysis: result.analysis };
        } catch {
          allFrames[f.index] = { ...f, analysisStatus: 'error' };
        }
        setFrames([...allFrames]);
      }
    } else {
      setProgress(90);
      setStatusMsg('Skipping AI — selecting by motion score…');
    }

    setProgress(100);
    setPhase('done');
    const best = selectBestActions(allFrames, MAX_ACTIONS);
    const final = allFrames.map(f => ({
      ...f,
      isSelected: best.some(b => b.index === f.index),
      refinedTimestamp: Math.max(0, f.timestamp - 2.5),
    }));
    setFrames(final);
    onComplete(final);
  }

  async function handleStart() {
    setError(null);
    if (useServerCV) await startServerCV();
    else await startClientExtraction();
  }

  const isRunning = ['extracting', 'detecting', 'analyzing'].includes(phase);

  return (
    <div className="flex flex-col h-[calc(100vh-73px)]">
      <div className="flex-1 flex flex-col gap-4 p-6 overflow-auto">
        {phase === 'idle' && (
          <div className="max-w-xl mx-auto w-full">
            <h2 className="text-xl font-semibold mb-4">Analysis settings</h2>
            <div className="bg-gray-900 rounded-xl p-5 flex flex-col gap-4">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="font-medium">AI frame analysis</p>
                  <p className="text-sm text-gray-400">Vision AI picks the best action moments. ~{AI_CANDIDATES * (AI_CALL_DELAY_MS / 1000)}s extra.</p>
                </div>
                <div onClick={() => setRunAI(v => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${runAI ? 'bg-indigo-600' : 'bg-gray-600'}`}>
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${runAI ? 'translate-x-5' : ''}`} />
                </div>
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="font-medium">Enhanced server-side analysis</p>
                  <p className="text-sm text-gray-400">Uses OpenCV + FFmpeg + AI. More accurate.</p>
                </div>
                <input type="checkbox" checked={useServerCV}
                  onChange={e => setUseServerCV(e.target.checked)}
                  className="w-5 h-5 accent-indigo-500" />
              </label>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Frame interval (seconds)</label>
                <input type="number" min={0.5} max={5} step={0.5} value={intervalSec}
                  onChange={e => setIntervalSec(parseFloat(e.target.value))}
                  className="w-24 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm" />
              </div>
              <button onClick={handleStart}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-lg transition-colors">
                Start analysis
              </button>
            </div>
          </div>
        )}

        {isRunning && (
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
            <button onClick={() => setPhase('idle')} className="text-sm text-red-400 underline">Try again</button>
          </div>
        )}

        {frames.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-300">
                {frames.length} frames &middot; {frames.filter(f => f.isSelected).length} selected
              </h3>
              {neurons && (
                <span className={`text-xs px-2 py-1 rounded ${neurons.dailyTotal >= 8000 ? 'bg-yellow-900 text-yellow-300' : 'bg-gray-800 text-gray-400'}`}>
                  {neurons.dailyTotal} / {neurons.dailyLimit} neurons
                </span>
              )}
            </div>
            <div className="grid grid-cols-5 sm:grid-cols-8 lg:grid-cols-10 gap-2">
              {frames.map(f => (
                <div key={f.index}
                  className={`relative cursor-pointer rounded overflow-hidden border-2 transition-all
                    ${f.isSelected ? 'border-indigo-400' : 'border-transparent hover:border-gray-600'}`}
                  onClick={() => setInspected(f)}>
                  {f.thumbnailUrl ? (
                    <img src={f.thumbnailUrl} alt={`Frame ${f.index}`} className="w-full aspect-video object-cover" />
                  ) : (
                    <div className="w-full aspect-video bg-gray-800 flex items-center justify-center text-xs text-gray-500">
                      {f.timestamp.toFixed(1)}s
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 h-1">
                    <div className={`h-full ${(f.motionScore ?? 0) >= MOTION_THRESHOLD ? 'bg-orange-500' : 'bg-gray-700'}`}
                      style={{ width: `${((f.motionScore ?? 0) / maxScore) * 100}%` }} />
                  </div>
                  {f.analysisStatus === 'analyzing' && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <div className="w-4 h-4 border border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {f.analysis?.isAction && <div className="absolute top-0.5 right-0.5 w-2 h-2 bg-green-400 rounded-full" />}
                  {f.isSelected && <div className="absolute top-0.5 left-0.5 text-[9px] bg-indigo-600 rounded px-0.5">&#x2713;</div>}
                </div>
              ))}
            </div>
          </>
        )}

        {inspected && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6" onClick={() => setInspected(null)}>
            <div className="bg-gray-900 rounded-2xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold">Frame {inspected.index} &middot; {inspected.timestamp.toFixed(2)}s</p>
                <button onClick={() => setInspected(null)} className="text-gray-500 hover:text-white">&#x2715;</button>
              </div>
              {inspected.thumbnailUrl && <img src={inspected.thumbnailUrl} alt="frame" className="w-full rounded-lg mb-3" />}
              {inspected.analysis ? (
                <div className="text-sm space-y-1 text-gray-300">
                  <p><span className="text-gray-500">Action:</span> {inspected.analysis.isAction ? 'yes' : 'no'} ({inspected.analysis.actionType})</p>
                  <p><span className="text-gray-500">Importance:</span> {inspected.analysis.importance}/10</p>
                  <p><span className="text-gray-500">Label:</span> {inspected.analysis.actionLabel || '—'}</p>
                  <p><span className="text-gray-500">Motion:</span> {((inspected.motionScore ?? 0) * 100).toFixed(1)}%</p>
                  {inspected.analysis.description && <p className="text-gray-400 text-xs mt-2">{inspected.analysis.description}</p>}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">Not analyzed</p>
              )}
            </div>
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={diffCanvasRef} className="hidden" />
    </div>
  );
}
