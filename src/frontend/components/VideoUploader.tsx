import React, { useState, useRef } from 'react';
import type { Session } from '../lib/types';

interface Props {
  onComplete: (file: File, session: Session) => void;
}

export default function VideoUploader({ onComplete }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (!file.type.startsWith('video/')) {
      setError('Select a video file — MP4 or WebM');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError('File too large — max 100 MB');
      return;
    }
    setError(null);
    const localId = Math.random().toString(36).slice(2, 14);
    const session: Session = {
      id: localId,
      createdAt: new Date().toISOString(),
      videoKey: '',
      videoUrl: '',
      totalFrames: 0,
      analyzedFrames: 0,
      status: 'ready',
      config: {
        width: 360, height: 640, posterFrameIndex: 0,
        autoplayAfterTap: true, loopVideo: false, muteByDefault: true,
        backgroundColor: '#000000', clickThroughUrl: '', timeline: [], layers: [],
      },
    };
    onComplete(file, session);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div className="upload-bg-grid" style={{
      minHeight: 'calc(100vh - 52px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 24px',
      background: 'var(--bg)',
    }}>
      <div className="upload-glow-orb" style={{ width: '100%', maxWidth: 520 }}>
        {/* Headline */}
        <div className="afu" style={{ textAlign: 'center', marginBottom: 36 }}>
          <div className="text-gradient" style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(28px, 5vw, 42px)',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            marginBottom: 12,
          }}>
            Drop your gameplay.
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text-2)',
            letterSpacing: '0.04em',
          }}>
            MP4 or WebM · up to 100 MB · stays local until export
          </div>
        </div>

        {/* Drop zone */}
        <div
          className={`upload-zone upload-scan afu d1${dragging ? ' drag-over' : ''}`}
          style={{ padding: '56px 32px', textAlign: 'center' }}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-drag={dragging ? 'true' : undefined}
        >
          {/* Icon */}
          <div className="upload-icon-float" style={{
            width: 52,
            height: 52,
            borderRadius: 10,
            border: '1px solid var(--border-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            background: 'var(--bg-2)',
            fontSize: 22,
          }}>
            🎬
          </div>

          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            fontWeight: 700,
            color: dragging ? 'var(--accent)' : 'var(--text)',
            marginBottom: 8,
            transition: 'color 0.2s',
          }}>
            {dragging ? 'Release to upload' : 'Drag & drop here'}
          </div>

          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-2)',
            marginBottom: 20,
          }}>
            or click to browse files
          </div>

          <button
            className="btn btn-primary"
            style={{ fontSize: 11, padding: '8px 20px' }}
            onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
          >
            Select File
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="afu error-shake" style={{
            marginTop: 12,
            padding: '10px 14px',
            borderRadius: 6,
            background: 'rgba(255,59,92,0.08)',
            border: '1px solid rgba(255,59,92,0.2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--danger)',
          }}>
            {error}
          </div>
        )}

        {/* Feature tags */}
        <div className="afu d2" style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          justifyContent: 'center',
          marginTop: 28,
        }}>
          {['Optical Flow', 'Scene Detection', 'CV Scoring', 'HTML5 Export'].map((t, i) => (
            <span key={t} className={`tag afu d${i + 3}`}>
              <span className="tag-dot" />
              {t}
            </span>
          ))}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
    </div>
  );
}
