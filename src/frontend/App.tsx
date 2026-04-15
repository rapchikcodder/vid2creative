import React, { useState } from 'react';
import { useHistory } from './hooks/useHistory';
import VideoUploader from './components/VideoUploader';
import FrameExtractor from './components/FrameExtractor';
import OverlayEditor from './components/OverlayEditor';
import ExportPanel from './components/ExportPanel';
import type { Session, ExtractedFrame, CreativeConfig, TimelineEvent, AnimationType, CTAButton, OverlayElement } from './lib/types';

type Step = 'upload' | 'extract' | 'edit' | 'export';

const DEFAULT_CTA: CTAButton = {
  text: 'Play Now',
  position: { x: 50, y: 80 },
  style: 'pulse',
  size: 'large',
  visible: true,
  action: 'link',
};

const DEFAULT_OVERLAY: OverlayElement = {
  type: 'none',
  text: '',
  position: 'top-right',
  visible: false,
};

const DEFAULT_CONFIG: CreativeConfig = {
  width: 360,
  height: 640,
  posterFrameIndex: 0,
  autoplayAfterTap: true,
  loopVideo: false,
  muteByDefault: true,
  backgroundColor: '#000000',
  clickThroughUrl: '',
  timeline: [],
};

export default function App() {
  const [step, setStep] = useState<Step>('upload');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const { state: config, push: pushConfig, undo: undoConfig, redo: redoConfig, canUndo, canRedo } = useHistory<CreativeConfig>(DEFAULT_CONFIG);

  function handleUploadComplete(file: File, sess: Session) {
    setVideoFile(file);
    setSession(sess);
    setStep('extract');
  }

  function handleAnalysisComplete(analyzedFrames: ExtractedFrame[], focusX?: number) {
    setFrames(analyzedFrames);

    // Build initial timeline from selected frames (2.5s pre-offset)
    const events: TimelineEvent[] = analyzedFrames
      .filter(f => f.isSelected)
      .map((f) => ({
        id: Math.random().toString(36).slice(2, 10),
        frameIndex: f.index,
        timestamp: f.refinedTimestamp ?? Math.max(0, f.timestamp - 2.5),
        duration: 0.6,
        cta: f.analysis?.cta ?? { ...DEFAULT_CTA, text: f.analysis?.actionLabel || 'Play Now' },
        overlay: f.analysis?.overlay ?? DEFAULT_OVERLAY,
        animation: (f.analysis?.animationSuggestion ?? 'fade-in') as AnimationType,
        pauseVideo: true,
      }));

    pushConfig({
      ...config,
      timeline: events,
      posterFrameIndex: analyzedFrames[0]?.index ?? 0,
      videoUrl: session?.videoUrl ?? '',
      focusX: focusX ?? config.focusX,
    } as CreativeConfig);

    setStep('edit');
  }

  function handleConfigChange(next: CreativeConfig) {
    pushConfig(next);
  }

  const STEPS: { key: Step; label: string; num: number }[] = [
    { key: 'upload', label: 'Upload', num: 1 },
    { key: 'extract', label: 'Analyze', num: 2 },
    { key: 'edit', label: 'Edit', num: 3 },
    { key: 'export', label: 'Export', num: 4 },
  ];

  const stepIdx = STEPS.findIndex(s => s.key === step);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-sm font-bold">v2</div>
          <span className="text-lg font-semibold tracking-tight">vid2creative</span>
        </div>
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.key}>
              {i > 0 && <div className="w-8 h-px bg-gray-700" />}
              <div
                className={`flex items-center gap-1.5 text-sm ${i <= stepIdx ? 'text-white' : 'text-gray-600'} ${i < stepIdx ? 'cursor-pointer hover:opacity-80' : ''}`}
                onClick={() => { if (i < stepIdx) setStep(STEPS[i].key); }}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                  ${i < stepIdx ? 'bg-indigo-600' : i === stepIdx ? 'bg-indigo-500 ring-2 ring-indigo-300' : 'bg-gray-800'}`}>
                  {i < stepIdx ? '✓' : s.num}
                </div>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
            </React.Fragment>
          ))}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {step === 'upload' && (
          <VideoUploader onComplete={handleUploadComplete} />
        )}
        {step === 'extract' && session && videoFile && (
          <FrameExtractor
            session={session}
            videoFile={videoFile}
            onComplete={handleAnalysisComplete}
          />
        )}
        {step === 'edit' && session && videoFile && (
          <OverlayEditor
            videoFile={videoFile}
            frames={frames}
            config={config}
            onConfigChange={handleConfigChange}
            onUndo={undoConfig}
            onRedo={redoConfig}
            canUndo={canUndo}
            canRedo={canRedo}
            onBack={() => setStep('extract')}
            onNext={() => setStep('export')}
          />
        )}
        {step === 'export' && session && (
          <ExportPanel
            session={session}
            videoFile={videoFile!}
            frames={frames}
            config={config}
            onConfigChange={handleConfigChange}
            onBack={() => setStep('edit')}
          />
        )}
      </main>
    </div>
  );
}
