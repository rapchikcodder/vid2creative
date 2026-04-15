import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ExtractedFrame, CreativeConfig, TimelineEvent, CTAButton, AnimationType, ButtonStyle } from '../lib/types';
import TemplateSelector from './TemplateSelector';

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

const CTA_STYLES: Record<string, React.CSSProperties> = {
  primary:   { background: 'linear-gradient(135deg,#6c5ce7,#a29bfe)', boxShadow: '0 4px 20px rgba(108,92,231,.5)' },
  secondary: { background: 'rgba(255,255,255,.15)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.3)' },
  floating:  { background: 'linear-gradient(135deg,#00d2d3,#54a0ff)', borderRadius: '50px', boxShadow: '0 6px 25px rgba(0,210,211,.4)' },
  pulse:     { background: 'linear-gradient(135deg,#ff6b6b,#ee5a24)', boxShadow: '0 0 20px rgba(255,107,107,.4)' },
  glow:      { background: 'linear-gradient(135deg,#f9ca24,#f0932b)', boxShadow: '0 0 30px rgba(249,202,36,.5)' },
  'slide-in':{ background: 'linear-gradient(135deg,#2d3436,#636e72)' },
  bounce:    { background: 'linear-gradient(135deg,#0984e3,#74b9ff)' },
  glass:     { background: 'rgba(255,255,255,.1)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.2)', boxShadow: '0 8px 32px rgba(0,0,0,.3)' },
};
const CTA_SIZES: Record<string, React.CSSProperties> = {
  small:  { padding: '8px 16px',  fontSize: '11px' },
  medium: { padding: '12px 28px', fontSize: '13px' },
  large:  { padding: '16px 36px', fontSize: '16px', borderRadius: '12px' },
};

export default function OverlayEditor({ videoFile, frames, config, onConfigChange, onUndo, onRedo, canUndo, canRedo, onBack, onNext }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoWrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');

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

  function addActionHere() {
    const ts = videoRef.current?.currentTime ?? 0;
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setPlaying(false);
    }
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
  }

  function deleteEvent(id: string) {
    onConfigChange({ ...config, timeline: config.timeline.filter(e => e.id !== id) });
    if (selectedEventId === id) setSelectedEventId(null);
  }

  function updateEvent(id: string, patch: Partial<TimelineEvent>) {
    onConfigChange({
      ...config,
      timeline: config.timeline.map(e => e.id === id ? { ...e, ...patch } : e),
    });
  }

  function updateCta(id: string, patch: Partial<CTAButton>) {
    const event = config.timeline.find(e => e.id === id);
    if (!event) return;
    updateEvent(id, { cta: { ...event.cta, ...patch } });
  }

  // Keyboard shortcuts: ⌘Z undo, ⌘⇧Z redo, Space play/pause, ←/→ frame step
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
      if (e.key === 'ArrowLeft' && videoRef.current)
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 1 / 30);
      if (e.key === 'ArrowRight' && videoRef.current)
        videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 1 / 30);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onUndo, onRedo, duration]);

  // Drag CTA position in video preview
  function handleCtaDragStart(e: React.MouseEvent, eventId: string) {
    e.preventDefault();
    e.stopPropagation();
    const wrap = videoWrapRef.current;
    if (!wrap) return;
    function onMove(ev: MouseEvent) {
      const rect = wrap!.getBoundingClientRect();
      const x = Math.round(((ev.clientX - rect.left) / rect.width) * 100);
      const y = Math.round(((ev.clientY - rect.top) / rect.height) * 100);
      updateCta(eventId, { position: { x: Math.max(5, Math.min(95, x)), y: Math.max(5, Math.min(95, y)) } });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

  // Always show selected event's button so edits are visible instantly
  const activeOverlays = config.timeline.filter(e =>
    e.cta.visible && (
      e.id === selectedEventId ||
      (currentTime >= e.timestamp && currentTime < e.timestamp + e.duration)
    ),
  );

  return (
    <div className="flex h-[calc(100vh-73px)]">
      {/* Left panel: video + timeline */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-gray-800">
        <div className="flex-1 flex items-center justify-center bg-gray-950 relative overflow-hidden">
          <div ref={videoWrapRef} className="relative" style={{ maxHeight: '60vh' }}>
            <video
              ref={videoRef}
              src={videoUrl.current}
              className="max-h-[60vh] max-w-full rounded-lg"
              onLoadedMetadata={e => setDuration((e.target as HTMLVideoElement).duration)}
              onEnded={() => setPlaying(false)}
              muted
            />
            {activeOverlays.map(ev => (
              <div key={ev.id}
                className="absolute"
                style={{ left: `${ev.cta.position.x}%`, top: `${ev.cta.position.y}%`, transform: 'translate(-50%, -50%)',
                  cursor: ev.id === selectedEventId ? 'move' : 'default', pointerEvents: ev.id === selectedEventId ? 'auto' : 'none' }}
                onMouseDown={ev.id === selectedEventId ? (e) => handleCtaDragStart(e, ev.id) : undefined}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px',
                  color: '#fff', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
                  outline: ev.id === selectedEventId ? '2px solid rgba(255,255,255,0.6)' : 'none',
                  outlineOffset: '2px', userSelect: 'none',
                  ...(CTA_STYLES[ev.cta.style] ?? CTA_STYLES.primary),
                  ...(CTA_SIZES[ev.cta.size] ?? CTA_SIZES.medium),
                }}>
                  {ev.id === selectedEventId && <span className="mr-1 text-xs opacity-60">✥</span>}
                  {ev.cta.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-900 px-4 py-3 border-t border-gray-800">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={togglePlay}
              className="w-9 h-9 bg-indigo-600 hover:bg-indigo-500 rounded-full flex items-center justify-center text-sm transition-colors">
              {playing ? '⏸' : '▶'}
            </button>
            <span className="text-sm text-gray-300 font-mono">{fmt(currentTime)} / {fmt(duration)}</span>
            <div className="flex-1" />
            {[0.25, 0.5, 1].map(r => (
              <button key={r} onClick={() => setPlaybackRate(r)}
                className={`text-xs px-2 py-1 rounded transition-colors ${speed === r ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                {r}x
              </button>
            ))}
            <button onClick={addActionHere}
              className="ml-2 bg-green-700 hover:bg-green-600 text-white text-sm px-3 py-1.5 rounded-lg transition-colors">
              + Add Action Here
            </button>
            <button onClick={() => setShowTemplates(s => !s)}
              className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${showTemplates ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
              Templates {showTemplates ? '▴' : '▾'}
            </button>
          </div>

          {showTemplates && (
            <TemplateSelector
              config={config}
              onApply={next => { onConfigChange(next); setShowTemplates(false); }}
              onClear={() => { onConfigChange({ ...config, timeline: [] }); setShowTemplates(false); }}
            />
          )}

          <div className="relative h-8 bg-gray-800 rounded-lg overflow-hidden cursor-pointer"
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              if (videoRef.current) videoRef.current.currentTime = pct * duration;
            }}>
            <div className="absolute top-0 bottom-0 w-0.5 bg-white z-10 pointer-events-none"
              style={{ left: `${(currentTime / (duration || 1)) * 100}%` }} />
            {frames.filter(f => f.isSelected).map(f => (
              <div key={f.index} className="absolute top-0 h-3 w-0.5 bg-yellow-400 opacity-60"
                style={{ left: `${(f.timestamp / (duration || 1)) * 100}%` }} />
            ))}
            {config.timeline.map(ev => (
              <div key={ev.id}
                className={`absolute top-3 bottom-1 rounded cursor-pointer transition-colors
                  ${selectedEventId === ev.id ? 'bg-indigo-400' : 'bg-indigo-700 hover:bg-indigo-600'}`}
                style={{
                  left: `${(ev.timestamp / (duration || 1)) * 100}%`,
                  width: `${Math.max(0.5, (ev.duration / (duration || 1)) * 100)}%`,
                }}
                onClick={e => { e.stopPropagation(); setSelectedEventId(ev.id); }}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-600 mt-1">
            <span>0:00</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>
      </div>

      {/* Right panel: event editor */}
      <div className="w-72 flex flex-col bg-gray-900 overflow-auto">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="font-semibold">Events ({config.timeline.length})</h3>
          <div className="flex gap-1.5">
            <button onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)"
              className="w-8 h-8 flex items-center justify-center rounded transition-colors disabled:opacity-30 bg-gray-700 hover:bg-gray-600 text-sm">
              ↩
            </button>
            <button onClick={onRedo} disabled={!canRedo} title="Redo (⌘⇧Z)"
              className="w-8 h-8 flex items-center justify-center rounded transition-colors disabled:opacity-30 bg-gray-700 hover:bg-gray-600 text-sm">
              ↪
            </button>
            <button onClick={onBack}
              className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-1.5 rounded-lg transition-colors">
              &#x2190; Back
            </button>
            <button onClick={onNext}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-3 py-1.5 rounded-lg transition-colors">
              Export &#x2192;
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {config.timeline.length === 0 && (
            <div className="p-4 text-gray-500 text-sm text-center">
              No events yet.<br />Press &ldquo;Add Action Here&rdquo; while the video plays.
            </div>
          )}
          {config.timeline.map(ev => (
            <div key={ev.id}
              className={`border-b border-gray-800 cursor-pointer ${selectedEventId === ev.id ? 'bg-gray-800' : 'hover:bg-gray-800/50'}`}
              onClick={() => setSelectedEventId(selectedEventId === ev.id ? null : ev.id)}>
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{ev.cta.text || 'Untitled'}</p>
                  <p className="text-xs text-gray-500">{fmt(ev.timestamp)} &middot; {ev.duration}s</p>
                </div>
                <button onClick={e => { e.stopPropagation(); deleteEvent(ev.id); }}
                  className="text-gray-600 hover:text-red-400 text-sm">&#x2715;</button>
              </div>

              {selectedEventId === ev.id && (
                <div className="px-4 pb-4 space-y-3" onClick={e => e.stopPropagation()}>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Button text</label>
                    <input value={ev.cta.text}
                      onChange={e => updateCta(ev.id, { text: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Timestamp (s)</label>
                      <input type="number" min={0} step={0.1} value={ev.timestamp}
                        onChange={e => updateEvent(ev.id, { timestamp: parseFloat(e.target.value) })}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Duration (s)</label>
                      <input type="number" min={0.3} max={30} step={0.1} value={ev.duration}
                        onChange={e => updateEvent(ev.id, { duration: parseFloat(e.target.value) })}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Position <span className="text-gray-600">(drag in preview)</span></label>
                    <div className="flex gap-2 text-xs text-gray-300 font-mono bg-gray-800 rounded px-2 py-1.5 border border-gray-700">
                      <span>x: {ev.cta.position.x}%</span>
                      <span className="text-gray-600">·</span>
                      <span>y: {ev.cta.position.y}%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Style</label>
                    <select value={ev.cta.style}
                      onChange={e => updateCta(ev.id, { style: e.target.value as ButtonStyle })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm">
                      {['primary','secondary','floating','pulse','glow','slide-in','bounce','glass'].map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Size</label>
                    <div className="flex gap-2">
                      {(['small','medium','large'] as const).map(sz => (
                        <button key={sz} onClick={() => updateCta(ev.id, { size: sz })}
                          className={`flex-1 text-xs py-1 rounded transition-colors ${ev.cta.size === sz ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                          {sz}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Animation</label>
                    <select value={ev.animation}
                      onChange={e => updateEvent(ev.id, { animation: e.target.value as AnimationType })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm">
                      {['fade-in','slide-up','slide-left','slide-right','zoom-in','bounce','pulse','glow','shake'].map(a => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={ev.pauseVideo}
                      onChange={e => updateEvent(ev.id, { pauseVideo: e.target.checked })}
                      className="accent-indigo-500" />
                    <span className="text-sm text-gray-300">Pause video when shown</span>
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
