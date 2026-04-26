import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { Session, ExtractedFrame, ScoredFrame } from '../lib/types';
import { useFrameExtraction } from '../hooks/useFrameExtraction';
import { useMLPipeline, selectTopActions, mergeMLResults } from '../hooks/useMLPipeline';

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
  const [intervalSec] = useState(1.0);
  const [sensitivity, setSensitivity] = useState(DEFAULT_SENSITIVITY);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement>(null);
  const startedRef = useRef(false);

  const { frames, framesRef, progress, statusMsg, isExtracting, setFrames, startExtraction } = useFrameExtraction();
  const { mlStatus, mlScores, mlClusters, mlError, mlFocusX, runMLPipeline } = useMLPipeline();

  const maxScore = frames.reduce((m, f) => Math.max(m, f.motionScore ?? 0), 0.001);

  // Transition phase to 'done' when ML finishes
  useEffect(() => {
    if (mlStatus === 'done' || mlStatus === 'error') setPhase('done');
  }, [mlStatus]);

  // Auto-start on mount
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      handleStart();
    }
  }, []);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
      setPhase('error');
    }
  }

  function toggleFrame(index: number) {
    const updated = frames.map(f => f.index === index ? { ...f, isSelected: !f.isSelected } : f);
    framesRef.current = updated;
    setFrames(updated);
  }

  function selectAll() {
    const updated = frames.map(f => ({ ...f, isSelected: true }));
    framesRef.current = updated;
    setFrames(updated);
  }

  function selectNone() {
    const updated = frames.map(f => ({ ...f, isSelected: false }));
    framesRef.current = updated;
    setFrames(updated);
  }

  function handleContinue() {
    const selected = frames.filter(f => f.isSelected).map(f => ({ ...f, refinedTimestamp: f.timestamp }));
    if (selected.length === 0) { setError('Select at least one action frame'); return; }
    onComplete(frames, mlFocusX);
  }

  const selectedCount = frames.filter(f => f.isSelected).length;

  const S = {
    root: { display: 'flex', flexDirection: 'column' as const, height: 'calc(100vh - 52px)' },
    body: { flex: 1, overflowY: 'auto' as const, padding: '16px 20px 0' },
    footer: {
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-1)',
      padding: '12px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexShrink: 0,
    },
  };

  return (
    <div style={S.root}>

      <div style={S.body}>

        {/* Status bar — shows during extraction and ML */}
        {(phase === 'extracting' || phase === 'ml-running' || phase === 'done') && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
            padding: '10px 14px',
            background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 6,
          }}>
            {/* Phase indicator */}
            {isExtracting && (
              <>
                <div className="spinner" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', marginBottom: 5 }}>
                    {statusMsg}
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', flexShrink: 0 }}>
                  {progress}%
                </span>
              </>
            )}
            {!isExtracting && mlStatus === 'uploading' && (
              <><div className="spinner" /><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--warning)' }}>Uploading for CV analysis…</span></>
            )}
            {!isExtracting && mlStatus === 'detecting' && (
              <>
                <div className="status-dot pulsing" />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>
                  Running optical flow + scene detection…
                </span>
              </>
            )}
            {!isExtracting && mlStatus === 'done' && (
              <><div className="status-dot done" /><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--success)' }}>CV complete — {selectedCount} actions detected</span></>
            )}
            {!isExtracting && mlStatus === 'error' && (
              <><div className="status-dot error" /><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)' }}>CV failed: {mlError} — using browser scores</span></>
            )}
            {!isExtracting && mlStatus === 'idle' && (
              <><div className="status-dot" style={{ background: 'var(--text-3)' }} /><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>Browser motion detection</span></>
            )}
          </div>
        )}

        {/* Error */}
        {phase === 'error' && error && (
          <div style={{
            maxWidth: 480, margin: '0 auto 16px',
            padding: '14px 16px',
            background: 'rgba(255,59,92,0.08)',
            border: '1px solid rgba(255,59,92,0.2)',
            borderRadius: 8,
          }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)', margin: '0 0 10px' }}>
              {error}
            </p>
            <button className="btn btn-ghost btn-sm" onClick={() => { startedRef.current = false; setPhase('idle'); setError(null); handleStart(); }}>
              Retry
            </button>
          </div>
        )}

        {/* Frames grid */}
        {frames.length > 0 && (
          <div>

            {/* Controls row: sensitivity + All/None */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              {mlScores && (
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', background: 'var(--bg-1)',
                  border: '1px solid var(--border)', borderRadius: 6,
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
                    Threshold
                  </span>
                  <input
                    type="range" min={0.1} max={0.8} step={0.05}
                    value={sensitivity}
                    onChange={e => setSensitivity(parseFloat(e.target.value))}
                    className="slider"
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', minWidth: 36, textAlign: 'right' }}>
                    {(sensitivity * 100).toFixed(0)}%
                  </span>
                </div>
              )}

              {/* Bulk select */}
              {frames.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" onClick={selectAll}
                    style={{ padding: '5px 10px', fontSize: 10 }}>All</button>
                  <button className="btn btn-ghost btn-sm" onClick={selectNone}
                    style={{ padding: '5px 10px', fontSize: 10 }}>None</button>
                </div>
              )}
            </div>

            {/* Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
              gap: 5,
              paddingBottom: 16,
            }}>
              {frames.map(f => {
                const mlFrame = mlScores?.find(s => s.index === f.index);
                const cvConf = mlFrame?.cv_confidence;
                const isSelected = !!f.isSelected;
                const hasML = !!mlScores;
                return (
                  <div
                    key={f.index}
                    className={`frame-cell ${isSelected ? 'selected' : hasML ? 'unselected' : ''}`}
                    onClick={() => toggleFrame(f.index)}
                    title={`t=${f.timestamp.toFixed(1)}s${cvConf !== undefined ? ' · cv=' + (cvConf*100).toFixed(0) + '%' : ''}`}
                  >
                    {f.thumbnailUrl ? (
                      <img src={f.thumbnailUrl} alt={`${f.index}`} />
                    ) : (
                      <div style={{
                        width: '100%', aspectRatio: '9/16', background: 'var(--bg-3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)',
                      }}>
                        {f.timestamp.toFixed(1)}s
                      </div>
                    )}
                    <span className="frame-badge">{f.timestamp.toFixed(1)}s</span>
                    {isSelected && <span className="frame-selected-mark">✓</span>}
                    {cvConf !== undefined && cvConf >= sensitivity && !isSelected && (
                      <span className="frame-cv-badge">{(cvConf * 100).toFixed(0)}%</span>
                    )}
                    <div className="frame-score-bar">
                      <div className="frame-score-fill" style={{
                        width: cvConf !== undefined
                          ? `${cvConf * 100}%`
                          : `${((f.motionScore ?? 0) / maxScore) * 100}%`,
                      }} />
                    </div>
                    {/* Inspect detail button */}
                    <button
                      className="frame-inspect-btn"
                      onClick={e => { e.stopPropagation(); setInspected(f); }}
                      title="View scores"
                    >i</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Inspect Modal */}
        {inspected && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 24 }}
            onClick={() => setInspected(null)}
          >
            <div className="panel" style={{ maxWidth: 360, width: '100%', padding: 20 }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)' }}>
                  Frame {inspected.index} · <span style={{ color: 'var(--accent)' }}>{inspected.timestamp.toFixed(2)}s</span>
                </span>
                <button className="btn btn-ghost btn-icon" onClick={() => setInspected(null)} style={{ fontSize: 14, lineHeight: 1 }}>×</button>
              </div>
              {inspected.thumbnailUrl && (
                <img src={inspected.thumbnailUrl} alt="frame" style={{ width: '100%', borderRadius: 6, marginBottom: 12 }} />
              )}
              {(() => {
                const mlFrame = mlScores?.find(s => s.index === inspected.index);
                if (!mlFrame) return (
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>ML scores not yet available</p>
                );
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {[
                      ['CV Score', `${(mlFrame.cv_confidence * 100).toFixed(1)}%`],
                      ['Motion', `${(mlFrame.motion_score * 100).toFixed(1)}%`],
                      ['Scene Proximity', `${(mlFrame.scene_proximity_score * 100).toFixed(1)}%`],
                      ['Motion Spike', `${(mlFrame.motion_spike_score * 100).toFixed(1)}%`],
                      ['Scene Boundary', mlFrame.near_scene_boundary ? `yes (${mlFrame.scene_type})` : 'no'],
                    ].map(([k, v]) => (
                      <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-2)' }}>{k}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Footer bar */}
      <div style={S.footer}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>
            {frames.length} frames
          </span>
          {frames.length > 0 && (
            <>
              <span style={{ color: 'var(--border-2)' }}>·</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: selectedCount > 0 ? 'var(--accent)' : 'var(--text-3)' }}>
                {selectedCount} selected
              </span>
            </>
          )}
        </div>

        {selectedCount > 0 && (phase === 'ml-running' || phase === 'done') && (
          <button className="btn btn-primary" onClick={handleContinue}>
            Continue with {selectedCount} frames →
          </button>
        )}
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <canvas ref={diffCanvasRef} style={{ display: 'none' }} />
    </div>
  );
}
