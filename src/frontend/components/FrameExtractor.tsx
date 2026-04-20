import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { Session, ExtractedFrame, ScoredFrame } from '../lib/types';
import { useFrameExtraction } from '../hooks/useFrameExtraction';
import { useMLPipeline, selectTopActions, mergeMLResults } from '../hooks/useMLPipeline';
import { useAIAnalysis } from '../hooks/useAIAnalysis';

const MAX_ACTIONS = 10;
const MIN_ACTION_GAP = 2.0;
const DEFAULT_SENSITIVITY = 0.45;

interface Props {
  session: Session;
  videoFile: File;
  onComplete: (frames: ExtractedFrame[], focusX?: number) => void;
}

type Phase = 'idle' | 'extracting' | 'ml-running' | 'done' | 'error';

export default function FrameExtractor({ session, videoFile, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [inspected, setInspected] = useState<ExtractedFrame | null>(null);
  const [intervalSec, setIntervalSec] = useState(1.0);
  const [runAI, setRunAI] = useState(false);
  const [sensitivity, setSensitivity] = useState(DEFAULT_SENSITIVITY);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement>(null);

  const { frames, framesRef, progress, statusMsg, isExtracting, setFrames, startExtraction } = useFrameExtraction();
  const { mlStatus, mlScores, mlClusters, mlError, mlFocusX, runMLPipeline } = useMLPipeline();
  const { aiStatus, neurons, statusMsg: aiStatusMsg, runAIAnalysis } = useAIAnalysis();

  const maxScore = frames.reduce((m, f) => Math.max(m, f.motionScore ?? 0), 0.001);

  // Re-apply action markers when sensitivity changes
  useEffect(() => {
    if (!mlScores || framesRef.current.length === 0) return;
    const updated = mergeMLResults(framesRef.current, mlScores, sensitivity);
    framesRef.current = updated;
    setFrames(updated);
  }, [sensitivity, mlScores]);

  const updateFrames = useCallback((updated: ExtractedFrame[]) => {
    framesRef.current = updated;
    setFrames(updated);
  }, [framesRef, setFrames]);

  async function handleStart() {
    setError(null);
    try {
      setPhase('extracting');
      const extracted = await startExtraction(videoFile, intervalSec, canvasRef, diffCanvasRef);
      setPhase('ml-running');

      runMLPipeline(videoFile, intervalSec, sensitivity, extracted, updateFrames);

      if (runAI) {
        runAIAnalysis(session.id, extracted, updateFrames);
      }
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
      refinedTimestamp: f.timestamp,
    }));
    if (selected.length === 0) {
      setError('Select at least one action frame to continue');
      return;
    }
    onComplete(frames, mlFocusX);
  }

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
                  <p className="text-sm text-gray-400">Vision AI picks the best action moments. ~52s extra. Uses neurons.</p>
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

        {frames.length > 0 && (
          <>
            {(phase === 'ml-running' || phase === 'done') && (
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  {mlStatus === 'uploading' && (
                    <>
                      <div className="w-4 h-4 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-yellow-400">Uploading video for ML analysis...</span>
                    </>
                  )}
                  {mlStatus === 'detecting' && (
                    <>
                      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-blue-400">Running ML detection (optical flow + scene detection)...</span>
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

            {aiStatus === 'running' && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-purple-400">{aiStatusMsg}</span>
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
                    <div className="absolute bottom-0 left-0 right-0 h-1">
                      <div className={`h-full ${(f.motionScore ?? 0) >= 0.08 ? 'bg-orange-500' : 'bg-gray-700'}`}
                        style={{ width: `${((f.motionScore ?? 0) / maxScore) * 100}%` }} />
                    </div>
                    {f.analysisStatus === 'analyzing' && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <div className="w-4 h-4 border border-purple-400 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                    {f.analysis?.isAction && <div className="absolute top-0.5 right-0.5 w-2.5 h-2.5 bg-purple-400 rounded-full border border-purple-600" />}
                    {cvConf !== undefined && cvConf >= sensitivity && !f.analysis?.isAction && (
                      <div className="absolute top-0.5 right-0.5 text-[8px] bg-green-600 text-white rounded px-1 font-bold">
                        {(cvConf * 100).toFixed(0)}%
                      </div>
                    )}
                    {f.isSelected && (
                      <div className="absolute top-0.5 left-0.5 text-[9px] bg-indigo-600 rounded px-0.5">&#x2713;</div>
                    )}
                  </div>
                );
              })}
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
