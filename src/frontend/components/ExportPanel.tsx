import React, { useState, useRef, useEffect } from 'react';
import { exportCreative } from '../lib/api';
import type { Session, ExtractedFrame, CreativeConfig } from '../lib/types';

interface Props {
  session: Session;
  frames: ExtractedFrame[];
  config: CreativeConfig;
  onConfigChange: (config: CreativeConfig) => void;
  onBack: () => void;
}

const PRESETS = [
  { label: 'Mobile', width: 360, height: 640 },
  { label: 'Mobile Alt', width: 320, height: 480 },
  { label: 'Banner', width: 300, height: 250 },
  { label: 'Square', width: 400, height: 400 },
];

export default function ExportPanel({ session, frames, config, onConfigChange, onBack }: Props) {
  const [exporting, setExporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!previewHtml || !previewContainerRef.current) return;
    const { clientWidth, clientHeight } = previewContainerRef.current;
    const scaleW = (clientWidth - 48) / config.width;
    const scaleH = (clientHeight - 64) / config.height;
    setPreviewScale(Math.min(1, scaleW, scaleH));
  }, [previewHtml, config.width, config.height]);

  function update(patch: Partial<CreativeConfig>) {
    onConfigChange({ ...config, ...patch });
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const blob = await exportCreative(session.id, config);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `creative-${session.id.slice(0, 8)}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    setError(null);
    try {
      const blob = await exportCreative(session.id, config);
      const text = await blob.text();
      setPreviewHtml(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-73px)]">
      {/* Left: config */}
      <div className="w-80 flex flex-col bg-gray-900 border-r border-gray-800 overflow-auto">
        <div className="p-5 border-b border-gray-800">
          <h2 className="text-lg font-semibold">Export settings</h2>
          <p className="text-sm text-gray-400 mt-1">{config.timeline.length} timeline events</p>
        </div>

        <div className="p-5 space-y-5 flex-1 overflow-auto">
          <div>
            <label className="text-sm font-medium text-gray-300 block mb-2">Dimensions</label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {PRESETS.map(p => (
                <button key={p.label} onClick={() => update({ width: p.width, height: p.height })}
                  className={`text-sm py-2 px-3 rounded-lg transition-colors text-left
                    ${config.width === p.width && config.height === p.height
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                  <span className="font-medium">{p.label}</span>
                  <span className="text-xs ml-1 opacity-70">{p.width}&times;{p.height}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <input type="number" value={config.width}
                onChange={e => update({ width: parseInt(e.target.value) })}
                className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm" />
              <span className="text-gray-500">&times;</span>
              <input type="number" value={config.height}
                onChange={e => update({ height: parseInt(e.target.value) })}
                className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm" />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-300 block mb-2">Poster frame</label>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {frames.slice(0, 20).map(f => (
                <div key={f.index}
                  className={`flex-shrink-0 w-16 cursor-pointer rounded overflow-hidden border-2 transition-all
                    ${config.posterFrameIndex === f.index ? 'border-indigo-400' : 'border-transparent'}`}
                  onClick={() => update({ posterFrameIndex: f.index })}>
                  {f.thumbnailUrl ? (
                    <img src={f.thumbnailUrl} alt={`Frame ${f.index}`} className="w-full aspect-video object-cover" />
                  ) : (
                    <div className="w-full aspect-video bg-gray-800 flex items-center justify-center text-xs text-gray-500">
                      {f.timestamp.toFixed(1)}s
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-300 block mb-1">Click-through URL</label>
            <input value={config.clickThroughUrl}
              onChange={e => update({ clickThroughUrl: e.target.value })}
              placeholder="https://..."
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-300 block mb-1">Background color</label>
            <div className="flex gap-2 items-center">
              <input type="color" value={config.backgroundColor}
                onChange={e => update({ backgroundColor: e.target.value })}
                className="w-10 h-10 rounded border border-gray-700 bg-transparent cursor-pointer" />
              <span className="text-sm text-gray-400">{config.backgroundColor}</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300 block">Playback options</label>
            {([['loopVideo', 'Loop video'], ['muteByDefault', 'Mute by default (required for autoplay)']] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox"
                  checked={Boolean(config[key as keyof CreativeConfig])}
                  onChange={e => update({ [key]: e.target.checked } as Partial<CreativeConfig>)}
                  className="accent-indigo-500" />
                <span className="text-sm text-gray-300">{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="p-5 border-t border-gray-800 space-y-2">
          {error && <div className="text-red-400 text-sm mb-2">{error}</div>}
          <button onClick={handlePreview} disabled={previewing}
            className="w-full bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50">
            {previewing ? 'Loading…' : 'Preview'}
          </button>
          <div className="flex gap-2">
            <button onClick={onBack}
              className="flex-none bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors">
              ← Edit
            </button>
            <button onClick={handleExport} disabled={exporting}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50">
              {exporting ? 'Exporting…' : '⬇ Download HTML'}
            </button>
          </div>
        </div>
      </div>

      {/* Right: preview */}
      <div ref={previewContainerRef} className="flex-1 flex items-center justify-center bg-gray-950 p-4 overflow-hidden">
        {previewHtml ? (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-xl overflow-hidden shadow-2xl"
              style={{ width: config.width, height: config.height, transform: `scale(${previewScale})`, transformOrigin: 'top center' }}>
              <iframe
                srcDoc={previewHtml}
                style={{ width: config.width, height: config.height, border: 'none', display: 'block' }}
                title="Creative preview"
              />
            </div>
            <p className="text-sm text-gray-500" style={{ marginTop: config.height * (previewScale - 1) }}>
              {config.width} &times; {config.height}px &middot; tap to play
            </p>
          </div>
        ) : (
          <div className="text-center text-gray-600">
            <div className="text-5xl mb-3">&#x1F3AC;</div>
            <p className="text-lg">Click Preview to see your creative</p>
            <p className="text-sm mt-1">or Download HTML to get the export</p>
          </div>
        )}
      </div>
    </div>
  );
}
