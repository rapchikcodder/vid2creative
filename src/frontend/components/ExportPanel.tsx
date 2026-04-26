import React, { useState, useRef, useEffect } from 'react';
import { uploadVideo, exportCreative } from '../lib/api';
import type { Session, ExtractedFrame, CreativeConfig } from '../lib/types';

interface Props {
  session: Session;
  videoFile: File;
  frames: ExtractedFrame[];
  config: CreativeConfig;
  onConfigChange: (config: CreativeConfig) => void;
  onBack: () => void;
}

const PRESETS = [
  { label: 'Unity Ads',   width: 360,  height: 640  },
  { label: 'AppLovin',    width: 320,  height: 480  },
  { label: 'Meta Story',  width: 1080, height: 1920 },
  { label: 'TikTok',      width: 1080, height: 1920 },
  { label: 'Landscape',   width: 640,  height: 360  },
  { label: 'Square',      width: 1080, height: 1080 },
  { label: 'Banner',      width: 300,  height: 250  },
];

export default function ExportPanel({ session, videoFile, frames, config, onConfigChange, onBack }: Props) {
  const [exporting,   setExporting]   = useState(false);
  const [previewing,  setPreviewing]  = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const uploadedRef = useRef<{ sessionId: string; videoUrl: string } | null>(null);

  useEffect(() => {
    if (!previewHtml || !previewContainerRef.current) return;
    const { clientWidth, clientHeight } = previewContainerRef.current;
    const scaleW = (clientWidth  - 80) / config.width;
    const scaleH = (clientHeight - 80) / config.height;
    setPreviewScale(Math.min(1, scaleW, scaleH));
  }, [previewHtml, config.width, config.height]);

  function update(patch: Partial<CreativeConfig>) {
    onConfigChange({ ...config, ...patch });
  }

  async function ensureUploaded() {
    if (uploadedRef.current) return uploadedRef.current;
    const result = await uploadVideo(videoFile);
    uploadedRef.current = result;
    return result;
  }

  async function handleExport() {
    setExporting(true); setError(null);
    try {
      const { sessionId, videoUrl } = await ensureUploaded();
      const blob = await exportCreative(sessionId, { ...config, videoUrl });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `creative-${sessionId.slice(0, 8)}.html`;
      a.click(); URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally { setExporting(false); }
  }

  async function handlePreview() {
    setPreviewing(true); setError(null);
    try {
      const { sessionId, videoUrl } = await ensureUploaded();
      const blob = await exportCreative(sessionId, { ...config, videoUrl });
      setPreviewHtml(await blob.text());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally { setPreviewing(false); }
  }

  const isPortrait = config.height > config.width;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)' }}>

      {/* Left: settings */}
      <div style={{
        width: 296, flexShrink: 0,
        background: 'var(--bg-1)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
            Export
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-2)' }}>
            {config.timeline.length} timeline events · {config.width}×{config.height}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

          {/* Dimensions */}
          <div style={{ marginBottom: 20 }}>
            <label className="label">Dimensions</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 8 }}>
              {PRESETS.map(p => {
                const active = config.width === p.width && config.height === p.height;
                return (
                  <button key={p.label}
                    className={`preset-dim-card${active ? ' active' : ''}`}
                    onClick={() => update({ width: p.width, height: p.height })}
                    style={{
                      padding: '7px 8px', borderRadius: 5, border: '1px solid',
                      borderColor: active ? 'var(--accent)' : 'var(--border-2)',
                      background: active ? 'var(--accent-bg)' : 'var(--bg-2)',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: active ? 'var(--accent)' : 'var(--text)' }}>
                      {p.label}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', marginTop: 1 }}>
                      {p.width}×{p.height}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="number" value={config.width}
                onChange={e => update({ width: parseInt(e.target.value) })}
                className="input" style={{ width: 72 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>×</span>
              <input type="number" value={config.height}
                onChange={e => update({ height: parseInt(e.target.value) })}
                className="input" style={{ width: 72 }} />
            </div>
          </div>

          {/* Poster frame */}
          <div style={{ marginBottom: 20 }}>
            <label className="label">Poster Frame</label>
            <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 4 }}>
              {frames.slice(0, 16).map(f => (
                <div key={f.index}
                  onClick={() => update({ posterFrameIndex: f.index })}
                  style={{
                    flexShrink: 0, width: 44, borderRadius: 4, overflow: 'hidden', cursor: 'pointer',
                    border: `1px solid ${config.posterFrameIndex === f.index ? 'var(--accent)' : 'transparent'}`,
                    boxShadow: config.posterFrameIndex === f.index ? '0 0 6px var(--accent-glow)' : 'none',
                  }}>
                  {f.thumbnailUrl ? (
                    <img src={f.thumbnailUrl} alt={`${f.index}`} style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '9/16', background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)' }}>
                      {f.timestamp.toFixed(0)}s
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Click-through URL */}
          <div style={{ marginBottom: 20 }}>
            <label className="label">Click-through URL</label>
            <input value={config.clickThroughUrl}
              onChange={e => update({ clickThroughUrl: e.target.value })}
              placeholder="https://..."
              className="input" />
          </div>

          {/* Background color */}
          <div style={{ marginBottom: 20 }}>
            <label className="label">Background Color</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="color" value={config.backgroundColor}
                onChange={e => update({ backgroundColor: e.target.value })}
                style={{
                  width: 32, height: 32, padding: 2, borderRadius: 5,
                  border: '1px solid var(--border-2)', background: 'transparent',
                  cursor: 'pointer',
                }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>
                {config.backgroundColor}
              </span>
            </div>
          </div>

          {/* Playback options */}
          <div style={{ marginBottom: 20 }}>
            <label className="label">Playback Options</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                <input type="checkbox" checked={config.loopVideo}
                  onChange={e => update({ loopVideo: e.target.checked })}  />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>Loop video</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                <input type="checkbox" checked={config.muteByDefault}
                  onChange={e => update({ muteByDefault: e.target.checked })} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>Mute by default</span>
              </label>
            </div>
          </div>

        </div>

        {/* Footer actions */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {error && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--error)', padding: '6px 8px', background: 'var(--error-bg)', borderRadius: 4 }}>
              {error}
            </div>
          )}
          <button className="btn btn-ghost"
            onClick={handlePreview} disabled={previewing}
            style={{ width: '100%' }}>
            {previewing ? (<><span className="spinner" style={{ width: 12, height: 12 }} /> Rendering...</>) : 'Preview'}
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost" onClick={onBack} style={{ flex: 1 }}>
              Back
            </button>
            <button className={`btn btn-primary${!exporting && previewHtml ? ' btn-export-ready' : ''}`}
              onClick={handleExport} disabled={exporting}
              style={{ flex: 2 }}>
              {exporting ? (<><span className="spinner" style={{ width: 12, height: 12, borderTopColor: '#000' }} /> Generating...</>) : 'Download HTML'}
            </button>
          </div>
        </div>
      </div>

      {/* Right: preview pane */}
      <div ref={previewContainerRef} className="export-preview-bg canvas-vignette" style={{
        flex: 1, background: 'var(--bg-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', position: 'relative',
      }}>
        {previewing && !previewHtml ? (
          <div style={{ textAlign: 'center' }}>
            <div className="spinner spinner-lg" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>
              Rendering creative…
            </div>
          </div>
        ) : previewHtml ? (
          <div className="scale-up" style={{
            transform: `scale(${previewScale})`,
            transformOrigin: 'center center',
            flexShrink: 0,
            position: 'relative', zIndex: 2,
          }}>
            <div className={isPortrait ? "phone-frame" : "phone-frame landscape"} style={{ width: config.width, height: config.height }}>
              <iframe
                srcDoc={previewHtml}
                style={{ width: '100%', height: '100%', border: 'none' }}
                sandbox="allow-scripts"
                title="Creative Preview"
              />
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', position: 'relative', zIndex: 2 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 10, border: '1px solid var(--border-2)',
              background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 12px', fontSize: 20,
            }}>
              ▶
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
              Click Preview to render
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>
              {config.width} × {config.height}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}