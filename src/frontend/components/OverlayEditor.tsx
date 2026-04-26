import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ExtractedFrame, CreativeConfig, TimelineEvent, CTAButton, AnimationType, ButtonStyle, Layer, LayerType, StartScreen } from '../lib/types';
import TemplateSelector from './TemplateSelector';
import LayerPanel from './LayerPanel';
import LayerPropertiesPanel from './LayerPropertiesPanel';
import LayerCanvas from './LayerCanvas';
import { useLayers } from '../hooks/useLayers';

interface ButtonPreset {
  id: string;
  text: string;
  style: ButtonStyle;
  size: 'small' | 'medium' | 'large';
  animation: AnimationType;
}

const BUTTON_PRESETS: ButtonPreset[] = [
  { id: 'play-now',  text: 'Play Now',     style: 'pulse',    size: 'large',  animation: 'zoom-in'  },
  { id: 'install',   text: 'Install Now',  style: 'glow',     size: 'large',  animation: 'bounce'   },
  { id: 'download',  text: 'Download',     style: 'primary',  size: 'large',  animation: 'slide-up' },
  { id: 'tap-play',  text: 'Tap to Play',  style: 'floating', size: 'large',  animation: 'fade-in'  },
  { id: 'try-free',  text: 'Try Free',     style: 'glass',    size: 'medium', animation: 'zoom-in'  },
  { id: 'get-now',   text: 'Get Now',      style: 'pulse',    size: 'medium', animation: 'bounce'   },
  { id: 'join-now',  text: 'Join Now',     style: 'glow',     size: 'medium', animation: 'slide-up' },
  { id: 'start',     text: 'Start',        style: 'primary',  size: 'large',  animation: 'fade-in'  },
  { id: 'play-free', text: 'Play Free',    style: 'bounce',   size: 'large',  animation: 'zoom-in'  },
  { id: 'claim',     text: 'Claim Reward', style: 'floating', size: 'medium', animation: 'pulse'    },
  { id: 'watch',     text: 'Watch More',   style: 'glass',    size: 'medium', animation: 'fade-in'  },
  { id: 'level-up',  text: 'Level Up',     style: 'glow',     size: 'medium', animation: 'bounce'   },
];

const DEFAULT_START_SCREEN: StartScreen = {
  enabled: false,
  backgroundColor: '#1a1a2e',
  logoSize: 80,
  headline: 'Play Now',
  subtext: '',
  ctaText: 'Start Playing',
  ctaStyle: 'pulse',
};

const CTA_STYLES: Record<string, React.CSSProperties> = {
  primary:    { background: 'linear-gradient(135deg,#6c5ce7,#a29bfe)', boxShadow: '0 4px 20px rgba(108,92,231,.5)' },
  secondary:  { background: 'rgba(255,255,255,.15)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.3)' },
  floating:   { background: 'linear-gradient(135deg,#00d2d3,#54a0ff)', borderRadius: '50px', boxShadow: '0 6px 25px rgba(0,210,211,.4)' },
  pulse:      { background: 'linear-gradient(135deg,#ff6b6b,#ee5a24)', boxShadow: '0 0 20px rgba(255,107,107,.4)' },
  glow:       { background: 'linear-gradient(135deg,#f9ca24,#f0932b)', boxShadow: '0 0 30px rgba(249,202,36,.5)' },
  'slide-in': { background: 'linear-gradient(135deg,#2d3436,#636e72)' },
  bounce:     { background: 'linear-gradient(135deg,#0984e3,#74b9ff)' },
  glass:      { background: 'rgba(255,255,255,.1)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.2)', boxShadow: '0 8px 32px rgba(0,0,0,.3)' },
};

const CTA_SIZES: Record<string, React.CSSProperties> = {
  small:  { padding: '8px 16px',  fontSize: '11px' },
  medium: { padding: '12px 28px', fontSize: '13px' },
  large:  { padding: '16px 36px', fontSize: '16px', borderRadius: '12px' },
};

interface Props {
  videoFile: File;
  frames: ExtractedFrame[];
  config: CreativeConfig;
  onConfigChange: (config: CreativeConfig) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onBack: () => void;
  onNext: () => void;
}

export default function OverlayEditor({ videoFile, frames, config, onConfigChange, onUndo, onRedo, canUndo, canRedo, onBack, onNext }: Props) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const videoWrapRef = useRef<HTMLDivElement>(null);
  const rafRef       = useRef<number>(0);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [currentTime,     setCurrentTime]     = useState(0);
  const [duration,        setDuration]        = useState(0);
  const [playing,         setPlaying]         = useState(false);
  const [speed,           setSpeed]           = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [videoUrl,        setVideoUrl]        = useState('');
  const [activeLeftTab,   setActiveLeftTab]   = useState<'elements' | 'upload' | 'templates'>('elements');
  const [activeRightTab,  setActiveRightTab]  = useState<'start' | 'timeline' | 'layers'>('timeline');
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [videoSize,       setVideoSize]       = useState({ width: 360, height: 640 });
  const [leftDragging,    setLeftDragging]    = useState(false);

  const ss = config.startScreen ?? DEFAULT_START_SCREEN;
  const layers = config.layers ?? [];
  const { addLayer, updateLayer, removeLayer, reorderLayers, duplicateLayer } = useLayers(
    config, onConfigChange, selectedLayerId, setSelectedLayerId,
  );

  function updateStartScreen(patch: Partial<StartScreen>) {
    onConfigChange({ ...config, startScreen: { ...ss, ...patch } });
  }

  function parseGradientColor2(): string {
    if (!ss.backgroundGradient) return '#a29bfe';
    const parts = ss.backgroundGradient.split(',').map(s => s.trim());
    return parts[2] ?? '#a29bfe';
  }

  useEffect(() => {
    const url = URL.createObjectURL(videoFile);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

  const tick = useCallback(() => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  function onVideoLoaded(e: React.SyntheticEvent<HTMLVideoElement>) {
    const v = e.target as HTMLVideoElement;
    setDuration(v.duration);
    setVideoSize({ width: v.clientWidth, height: v.clientHeight });
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  }

  function setPlaybackRate(r: number) {
    setSpeed(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  }

  function addPreset(preset: ButtonPreset) {
    const ts = videoRef.current?.currentTime ?? 0;
    const newEvent: TimelineEvent = {
      id: Math.random().toString(36).slice(2, 10),
      frameIndex: -1,
      timestamp: Math.max(0, Math.round((ts - 1.5) * 10) / 10),
      duration: 0.6,
      cta: { text: preset.text, position: { x: 50, y: 80 }, style: preset.style, size: preset.size, visible: true, action: 'link' },
      overlay: { type: 'none', text: '', position: 'top-right', visible: false },
      animation: preset.animation,
      pauseVideo: true,
    };
    onConfigChange({ ...config, timeline: [...config.timeline, newEvent] });
    setSelectedEventId(newEvent.id);
    setActiveRightTab('timeline');
  }

  function addActionHere() {
    const ts = videoRef.current?.currentTime ?? 0;
    if (videoRef.current && !videoRef.current.paused) { videoRef.current.pause(); setPlaying(false); }
    const newEvent: TimelineEvent = {
      id: Math.random().toString(36).slice(2, 10),
      frameIndex: -1,
      timestamp: Math.max(0, Math.round((ts - 1.5) * 10) / 10),
      duration: 0.6,
      cta: { text: 'Play Now', position: { x: 50, y: 80 }, style: 'pulse', size: 'large', visible: true, action: 'link' },
      overlay: { type: 'none', text: '', position: 'top-right', visible: false },
      animation: 'fade-in',
      pauseVideo: true,
    };
    onConfigChange({ ...config, timeline: [...config.timeline, newEvent] });
    setSelectedEventId(newEvent.id);
    setActiveRightTab('timeline');
  }

  function deleteEvent(id: string) {
    onConfigChange({ ...config, timeline: config.timeline.filter(e => e.id !== id) });
    if (selectedEventId === id) setSelectedEventId(null);
  }

  function updateEvent(id: string, patch: Partial<TimelineEvent>) {
    onConfigChange({ ...config, timeline: config.timeline.map(e => e.id === id ? { ...e, ...patch } : e) });
  }

  function updateCta(id: string, patch: Partial<CTAButton>) {
    const event = config.timeline.find(e => e.id === id);
    if (!event) return;
    updateEvent(id, { cta: { ...event.cta, ...patch } });
  }

  function handleImageDrop(file: File) {
    const reader = new FileReader();
    reader.onload = ev => {
      const src = ev.target?.result as string;
      const newLayer: Layer = {
        id: Math.random().toString(36).slice(2, 10),
        type: 'image',
        name: file.name.replace(/\.[^.]+$/, '') || 'Image',
        visible: true,
        locked: false,
        position: { x: 10, y: 10 },
        size: { width: 80, height: 40 },
        rotation: 0,
        opacity: 1,
        zIndex: (config.layers?.length ?? 0) + 1,
        data: { kind: 'image', src, objectFit: 'contain' },
      };
      onConfigChange({ ...config, layers: [...(config.layers ?? []), newLayer] });
      setSelectedLayerId(newLayer.id);
      setActiveRightTab('layers');
    };
    reader.readAsDataURL(file);
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => updateStartScreen({ logoSrc: ev.target?.result as string });
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) onRedo?.(); else onUndo?.();
      }
      if (e.key === ' ') {
        e.preventDefault();
        const v = videoRef.current;
        if (v) { if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); } }
      }
      if (e.key === 'ArrowLeft'  && videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 1/30);
      if (e.key === 'ArrowRight' && videoRef.current) videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 1/30);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onUndo, onRedo, duration]);

  function handleCtaDragStart(e: React.MouseEvent, eventId: string) {
    e.preventDefault(); e.stopPropagation();
    const wrap = videoWrapRef.current;
    if (!wrap) return;
    function onMove(ev: MouseEvent) {
      const rect = wrap!.getBoundingClientRect();
      const x = Math.round(((ev.clientX - rect.left) / rect.width) * 100);
      const y = Math.round(((ev.clientY - rect.top) / rect.height) * 100);
      updateCta(eventId, { position: { x: Math.max(5, Math.min(95, x)), y: Math.max(5, Math.min(95, y)) } });
    }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

  const activeOverlays = config.timeline.filter(e =>
    e.cta.visible && (
      e.id === selectedEventId ||
      (currentTime >= e.timestamp && currentTime < e.timestamp + e.duration)
    ),
  );

  const selectedLayer = layers.find(l => l.id === selectedLayerId) ?? null;

  const ssPreviewBg = ss.backgroundGradient
    ? `linear-gradient(${ss.backgroundGradient})`
    : ss.backgroundColor;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)' }}>

      {/* LEFT PANEL — 220px asset library */}
      <div className="asset-panel">
        <div style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div className="tab-bar" style={{ padding: '6px 8px 0' }}>
            <button className={`tab ${activeLeftTab === 'elements' ? 'active' : ''}`} onClick={() => setActiveLeftTab('elements')}>Elements</button>
            <button className={`tab ${activeLeftTab === 'upload' ? 'active' : ''}`} onClick={() => setActiveLeftTab('upload')}>Upload</button>
            <button className={`tab ${activeLeftTab === 'templates' ? 'active' : ''}`} onClick={() => setActiveLeftTab('templates')}>Templates</button>
          </div>
        </div>

        {/* Elements tab */}
        {activeLeftTab === 'elements' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div className="asset-section-title">Button Kit</div>
            <div className="btn-preset-grid">
              {BUTTON_PRESETS.map(p => (
                <button
                  key={p.id}
                  className="btn-preset-card"
                  onClick={() => addPreset(p)}
                  title={`${p.style} · ${p.animation}`}
                >
                  <span className="btn-preset-pill" style={CTA_STYLES[p.style]}>{p.text}</span>
                  <span className="btn-preset-name">{p.text}</span>
                </button>
              ))}
            </div>

            <div className="asset-section-title">Elements</div>
            <div className="element-add-row">
              <button className="element-add-btn" onClick={() => { addLayer('text'); setActiveRightTab('layers'); }}>
                <span className="element-add-icon">T</span>
                <span className="element-add-label">Text</span>
              </button>
              <button className="element-add-btn" onClick={() => { addLayer('shape'); setActiveRightTab('layers'); }}>
                <span className="element-add-icon">▭</span>
                <span className="element-add-label">Shape</span>
              </button>
              <button className="element-add-btn" onClick={() => { addLayer('progress'); setActiveRightTab('layers'); }}>
                <span className="element-add-icon">▓</span>
                <span className="element-add-label">Progress</span>
              </button>
            </div>
          </div>
        )}

        {/* Upload tab */}
        {activeLeftTab === 'upload' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0 0' }}>
            <div className="asset-section-title" style={{ paddingTop: 0 }}>Import Image</div>
            <div
              className={`upload-zone-sm${leftDragging ? ' dragover' : ''}`}
              onDragOver={e => { e.preventDefault(); setLeftDragging(true); }}
              onDragLeave={() => setLeftDragging(false)}
              onDrop={e => {
                e.preventDefault(); setLeftDragging(false);
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) handleImageDrop(file);
              }}
              onClick={() => {
                const inp = document.createElement('input');
                inp.type = 'file'; inp.accept = 'image/*';
                inp.onchange = ev => {
                  const file = (ev.target as HTMLInputElement).files?.[0];
                  if (file) handleImageDrop(file);
                };
                inp.click();
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 6, opacity: 0.4 }}>🖼</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5 }}>
                Drop PNG / JPG here<br />
                <span style={{ color: 'var(--text-3)' }}>or click to browse</span>
              </div>
            </div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', margin: '4px 12px 0', lineHeight: 1.5 }}>
              Export from Figma / Canva as PNG, then drop here
            </p>
          </div>
        )}

        {/* Templates tab */}
        {activeLeftTab === 'templates' && (
          <TemplateSelector
            config={config}
            onApply={next => { onConfigChange(next); setActiveRightTab('timeline'); }}
            onClear={() => onConfigChange({ ...config, timeline: [] })}
          />
        )}
      </div>

      {/* CENTER — video + controls */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>

        {/* Video area */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', overflow: 'hidden', position: 'relative' }}>
          <div ref={videoWrapRef} style={{ position: 'relative' }}>
            <LayerCanvas
              layers={layers}
              selectedId={selectedLayerId}
              currentTime={currentTime}
              containerWidth={videoSize.width}
              containerHeight={videoSize.height}
              onSelectLayer={id => { setSelectedLayerId(id); if (id) setActiveRightTab('layers'); }}
              onUpdateLayer={(id, patch) => updateLayer(id, patch)}
            >
              <video
                key={videoUrl}
                ref={videoRef}
                src={videoUrl}
                style={{ maxHeight: '58vh', maxWidth: '100%', display: 'block' }}
                onLoadedMetadata={onVideoLoaded}
                onEnded={() => setPlaying(false)}
                muted
              />
            </LayerCanvas>
            {/* CTA overlays */}
            {activeOverlays.map(ev => (
              <div key={ev.id}
                style={{
                  position: 'absolute',
                  left: `${ev.cta.position.x}%`, top: `${ev.cta.position.y}%`,
                  transform: 'translate(-50%,-50%)',
                  cursor: ev.id === selectedEventId ? 'move' : 'default',
                  pointerEvents: ev.id === selectedEventId ? 'auto' : 'none',
                  zIndex: 100,
                }}
                onMouseDown={ev.id === selectedEventId ? e => handleCtaDragStart(e, ev.id) : undefined}
              >
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px',
                  color: '#fff', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
                  outline: ev.id === selectedEventId ? '2px solid rgba(255,255,255,0.6)' : 'none',
                  outlineOffset: 2, userSelect: 'none',
                  ...(CTA_STYLES[ev.cta.style] ?? CTA_STYLES.primary),
                  ...(CTA_SIZES[ev.cta.size] ?? CTA_SIZES.medium),
                }}>
                  {ev.id === selectedEventId && <span style={{ marginRight: 4, opacity: 0.5, fontSize: 10 }}>✥</span>}
                  {ev.cta.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Playback controls + timeline */}
        <div style={{ background: 'var(--bg-1)', borderTop: '1px solid var(--border)', padding: '10px 14px 12px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <button
              onClick={togglePlay}
              style={{
                width: 34, height: 34, borderRadius: 6,
                background: 'var(--accent)', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, color: '#000', flexShrink: 0,
              }}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', flexShrink: 0 }}>
              {fmt(currentTime)} <span style={{ color: 'var(--text-3)' }}>/</span> {fmt(duration)}
            </span>
            <div style={{ flex: 1 }} />
            {[0.25, 0.5, 1].map(r => (
              <button key={r}
                onClick={() => setPlaybackRate(r)}
                className={speed === r ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                style={{ minWidth: 38 }}
              >
                {r}x
              </button>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={addActionHere}
              style={{ borderColor: 'rgba(198,255,0,0.3)', color: 'var(--accent)' }}>
              + Action
            </button>
          </div>

          {/* Timeline track */}
          <div
            className="timeline-track"
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              if (videoRef.current) videoRef.current.currentTime = pct * duration;
            }}
          >
            <div className="timeline-playhead" style={{ left: `${(currentTime / (duration || 1)) * 100}%` }} />
            {frames.filter(f => f.isSelected).map(f => (
              <div key={f.index} className="timeline-frame-marker"
                style={{ left: `${(f.timestamp / (duration || 1)) * 100}%` }} />
            ))}
            {config.timeline.map(ev => (
              <div key={ev.id}
                className={`timeline-event ${selectedEventId === ev.id ? 'selected' : ''}`}
                style={{
                  left: `${(ev.timestamp / (duration || 1)) * 100}%`,
                  width: `${Math.max(0.5, (ev.duration / (duration || 1)) * 100)}%`,
                }}
                onClick={e => { e.stopPropagation(); setSelectedEventId(ev.id); }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>0:00</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>{fmt(duration)}</span>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL — 280px */}
      <div style={{ width: 280, display: 'flex', flexDirection: 'column', background: 'var(--bg-1)', overflow: 'hidden', flexShrink: 0 }}>

        {/* Panel header */}
        <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="tab-bar" style={{ flex: 1, marginRight: 8 }}>
              <button className={`tab ${activeRightTab === 'start' ? 'active' : ''}`} onClick={() => setActiveRightTab('start')}>Start</button>
              <button className={`tab ${activeRightTab === 'timeline' ? 'active' : ''}`} onClick={() => setActiveRightTab('timeline')}>
                CTAs ({config.timeline.length})
              </button>
              <button className={`tab ${activeRightTab === 'layers' ? 'active' : ''}`} onClick={() => setActiveRightTab('layers')}>
                Layers ({layers.length})
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="btn btn-ghost btn-icon" onClick={onUndo} disabled={!canUndo} title="Undo (Cmd+Z)" style={{ fontSize: 13 }}>↩</button>
            <button className="btn btn-ghost btn-icon" onClick={onRedo} disabled={!canRedo} title="Redo (Cmd+Shift+Z)" style={{ fontSize: 13 }}>↪</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
            <button className="btn btn-primary btn-sm" onClick={onNext}>Export →</button>
          </div>
        </div>

        {/* START SCREEN TAB */}
        {activeRightTab === 'start' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div className="toggle-row">
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Start Screen</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>Intro before video plays</div>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={ss.enabled} onChange={e => updateStartScreen({ enabled: e.target.checked })} />
                <span className="toggle-slider" />
              </label>
            </div>

            {ss.enabled ? (
              <>
                {/* Mini phone preview */}
                <div className="start-preview-wrap">
                  <div className="start-preview" style={{ background: ssPreviewBg }}>
                    {ss.logoSrc
                      ? <img src={ss.logoSrc} className="start-preview-logo" style={{ width: 22, height: 22 }} alt="" />
                      : <div style={{ width: 22, height: 22, background: 'rgba(255,255,255,.15)', borderRadius: 3, flexShrink: 0 }} />
                    }
                    <div className="start-preview-headline">{ss.headline || 'Headline'}</div>
                    {ss.subtext && <div className="start-preview-sub">{ss.subtext}</div>}
                    <div className="start-preview-cta" style={CTA_STYLES[ss.ctaStyle]}>{ss.ctaText || 'CTA'}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 14px 16px' }}>

                  {/* Logo */}
                  <div>
                    <label className="label">Logo / App Icon</label>
                    <div className="logo-upload-zone" style={{ margin: 0 }} onClick={() => logoInputRef.current?.click()}>
                      {ss.logoSrc
                        ? <img src={ss.logoSrc} className="logo-preview" alt="" />
                        : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>Click to upload logo</span>
                      }
                    </div>
                    <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
                    {ss.logoSrc && (
                      <div style={{ marginTop: 8 }}>
                        <label className="label">Size: {ss.logoSize}px</label>
                        <input type="range" min={40} max={120} step={4} value={ss.logoSize}
                          onChange={e => updateStartScreen({ logoSize: parseInt(e.target.value) })}
                          style={{ width: '100%' }} />
                      </div>
                    )}
                  </div>

                  {/* Background */}
                  <div>
                    <label className="label">Background</label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="color" value={ss.backgroundColor}
                        onChange={e => {
                          const c1 = e.target.value;
                          if (ss.backgroundGradient) {
                            updateStartScreen({ backgroundColor: c1, backgroundGradient: `135deg, ${c1}, ${parseGradientColor2()}` });
                          } else {
                            updateStartScreen({ backgroundColor: c1 });
                          }
                        }}
                        style={{ width: 32, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer', padding: 2 }} />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-2)', cursor: 'pointer' }}>
                        <input type="checkbox"
                          checked={!!ss.backgroundGradient}
                          onChange={e => {
                            if (e.target.checked) {
                              updateStartScreen({ backgroundGradient: `135deg, ${ss.backgroundColor}, #a29bfe` });
                            } else {
                              updateStartScreen({ backgroundGradient: undefined });
                            }
                          }} />
                        Gradient
                      </label>
                      {ss.backgroundGradient && (
                        <input type="color" value={parseGradientColor2()}
                          onChange={e => updateStartScreen({ backgroundGradient: `135deg, ${ss.backgroundColor}, ${e.target.value}` })}
                          style={{ width: 32, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer', padding: 2 }} />
                      )}
                    </div>
                  </div>

                  {/* Headline */}
                  <div>
                    <label className="label">Headline</label>
                    <input value={ss.headline}
                      onChange={e => updateStartScreen({ headline: e.target.value })}
                      className="input" placeholder="Play Now" />
                  </div>

                  {/* Subtext */}
                  <div>
                    <label className="label">Subtext <span style={{ color: 'var(--text-3)' }}>(optional)</span></label>
                    <input value={ss.subtext}
                      onChange={e => updateStartScreen({ subtext: e.target.value })}
                      className="input" placeholder="Free to play · No ads" />
                  </div>

                  {/* CTA Text */}
                  <div>
                    <label className="label">CTA Button Text</label>
                    <input value={ss.ctaText}
                      onChange={e => updateStartScreen({ ctaText: e.target.value })}
                      className="input" placeholder="Start Playing" />
                  </div>

                  {/* CTA Style swatches */}
                  <div>
                    <label className="label">CTA Style</label>
                    <div className="style-swatch-grid">
                      {(Object.keys(CTA_STYLES) as ButtonStyle[]).map(s => (
                        <button
                          key={s}
                          className={`style-swatch${ss.ctaStyle === s ? ' active' : ''}`}
                          onClick={() => updateStartScreen({ ctaStyle: s })}
                          style={CTA_STYLES[s]}
                          title={s}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', lineHeight: 1.6 }}>
                Enable to show an intro card before the video plays. Add your logo, a headline, and a CTA.
              </div>
            )}
          </div>
        )}

        {/* TIMELINE TAB */}
        {activeRightTab === 'timeline' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {config.timeline.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
                No CTAs yet.<br />
                Pick from Button Kit on the left<br />or press "+ Action" above.
              </div>
            )}
            {config.timeline.map(ev => (
              <div
                key={ev.id}
                className={`event-item ${selectedEventId === ev.id ? 'active' : ''}`}
                style={{ padding: '10px 16px' }}
                onClick={() => setSelectedEventId(selectedEventId === ev.id ? null : ev.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                      {ev.cta.text || 'Untitled'}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-2)' }}>
                      {fmt(ev.timestamp)} · {ev.duration}s
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={e => { e.stopPropagation(); deleteEvent(ev.id); }}
                    style={{ fontSize: 11, color: 'var(--text-3)' }}
                  >×</button>
                </div>

                {selectedEventId === ev.id && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}
                    onClick={e => e.stopPropagation()}>

                    <div>
                      <label className="label">Button Text</label>
                      <input value={ev.cta.text}
                        onChange={e => updateCta(ev.id, { text: e.target.value })}
                        className="input" />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label className="label">Start (s)</label>
                        <input type="number" min={0} step={0.1} value={ev.timestamp}
                          onChange={e => updateEvent(ev.id, { timestamp: parseFloat(e.target.value) })}
                          className="input" />
                      </div>
                      <div>
                        <label className="label">Duration (s)</label>
                        <input type="number" min={0.3} max={30} step={0.1} value={ev.duration}
                          onChange={e => updateEvent(ev.id, { duration: parseFloat(e.target.value) })}
                          className="input" />
                      </div>
                    </div>

                    <div>
                      <label className="label">Position <span style={{ color: 'var(--text-3)' }}>(drag in preview)</span></label>
                      <div style={{
                        display: 'flex', gap: 8, padding: '6px 10px',
                        background: 'var(--bg-2)', borderRadius: 5, border: '1px solid var(--border)',
                        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)',
                      }}>
                        <span>x: {ev.cta.position.x}%</span>
                        <span style={{ color: 'var(--text-3)' }}>·</span>
                        <span>y: {ev.cta.position.y}%</span>
                      </div>
                    </div>

                    {/* Visual style swatches */}
                    <div>
                      <label className="label">Style</label>
                      <div className="style-swatch-grid">
                        {(Object.keys(CTA_STYLES) as ButtonStyle[]).map(s => (
                          <button
                            key={s}
                            className={`style-swatch${ev.cta.style === s ? ' active' : ''}`}
                            onClick={() => updateCta(ev.id, { style: s })}
                            style={CTA_STYLES[s]}
                            title={s}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="label">Size</label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(['small', 'medium', 'large'] as const).map(sz => (
                          <button key={sz}
                            onClick={() => updateCta(ev.id, { size: sz })}
                            className={ev.cta.size === sz ? 'btn btn-primary' : 'btn btn-ghost'}
                            style={{ flex: 1, padding: '5px', fontSize: 10 }}
                          >{sz}</button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="label">Animation</label>
                      <select value={ev.animation}
                        onChange={e => updateEvent(ev.id, { animation: e.target.value as AnimationType })}
                        className="select">
                        {['fade-in', 'slide-up', 'slide-left', 'slide-right', 'zoom-in', 'bounce', 'pulse', 'glow', 'shake'].map(a => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>
                    </div>

                    <label className="check-row" style={{ marginTop: 2 }}>
                      <input type="checkbox" checked={ev.pauseVideo}
                        onChange={e => updateEvent(ev.id, { pauseVideo: e.target.checked })} />
                      <span>Pause video when shown</span>
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* LAYERS TAB */}
        {activeRightTab === 'layers' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {selectedLayer ? (
              <>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelectedLayerId(null)}>← All</button>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {selectedLayer.name}
                  </span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <LayerPropertiesPanel layer={selectedLayer} onUpdate={patch => updateLayer(selectedLayer.id, patch)} />
                </div>
              </>
            ) : (
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <LayerPanel
                  layers={layers}
                  selectedId={selectedLayerId}
                  onSelect={id => setSelectedLayerId(id)}
                  onAdd={(type: LayerType) => addLayer(type)}
                  onUpdate={(id, patch) => updateLayer(id, patch)}
                  onRemove={id => removeLayer(id)}
                  onDuplicate={id => duplicateLayer(id)}
                  onReorder={ids => reorderLayers(ids)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
