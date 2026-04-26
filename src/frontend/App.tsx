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
  layers: [],
};

const STEPS: { key: Step; label: string; num: string }[] = [
  { key: 'upload',  label: 'Upload',  num: '01' },
  { key: 'extract', label: 'Analyze', num: '02' },
  { key: 'edit',    label: 'Edit',    num: '03' },
  { key: 'export',  label: 'Export',  num: '04' },
];

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
    const events: TimelineEvent[] = analyzedFrames
      .filter(f => f.isSelected)
      .map((f) => ({
        id: Math.random().toString(36).slice(2, 10),
        frameIndex: f.index,
        timestamp: f.refinedTimestamp ?? f.timestamp,
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

  const stepIdx = STEPS.findIndex(s => s.key === step);

  return (
    <>
      <div className="noise" />
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <header style={{
          borderBottom: '1px solid var(--border)',
          padding: '0 24px',
          height: 52,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-1)',
          flexShrink: 0,
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="logo-dot" />
            <span className="logo-mark">vid2creative</span>
          </div>

          {/* Step indicator */}
          <div className="step-bar">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.key}>
                {i > 0 && <div className={`step-connector ${i <= stepIdx ? 'done' : ''}`} />}
                <div
                  className={`step-node ${i === stepIdx ? 'active' : i < stepIdx ? 'done' : ''}`}
                  style={{ cursor: i < stepIdx ? 'pointer' : 'default' }}
                  onClick={() => { if (i < stepIdx) setStep(STEPS[i].key); }}
                >
                  <div className="step-num">
                    {i < stepIdx ? '✓' : s.num}
                  </div>
                  <span className="step-label" style={{ display: window.innerWidth < 640 ? 'none' : undefined }}>
                    {s.label}
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Right side: file info or spacer */}
          <div style={{ width: 120, display: 'flex', justifyContent: 'flex-end' }}>
            {videoFile && (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 120,
              }}>
                {videoFile.name}
              </span>
            )}
          </div>
        </header>

        {/* Main content */}
        <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {step === 'upload' && (
            <div key="upload" className="step-enter">
              <VideoUploader onComplete={handleUploadComplete} />
            </div>
          )}
          {step === 'extract' && session && videoFile && (
            <div key="extract" className="step-enter">
              <FrameExtractor
                session={session}
                videoFile={videoFile}
                onComplete={handleAnalysisComplete}
              />
            </div>
          )}
          {step === 'edit' && session && videoFile && (
            <div key="edit" className="step-enter" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
            </div>
          )}
          {step === 'export' && session && (
            <div key="export" className="step-enter">
              <ExportPanel
                session={session}
                videoFile={videoFile!}
                frames={frames}
                config={config}
                onConfigChange={handleConfigChange}
                onBack={() => setStep('edit')}
              />
            </div>
          )}
        </main>
      </div>
    </>
  );
}
