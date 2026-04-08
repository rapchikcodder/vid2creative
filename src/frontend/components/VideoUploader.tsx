import React, { useState, useRef } from 'react';
import { uploadVideo } from '../lib/api';
import type { Session } from '../lib/types';

interface Props {
  onComplete: (file: File, session: Session) => void;
}

export default function VideoUploader({ onComplete }: Props) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith('video/')) {
      setError('Please select a video file (MP4, WebM)');
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      setError('File too large (max 200 MB)');
      return;
    }
    setError(null);
    // Skip server upload — video stays local until export.
    // Generate a local session ID instantly.
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
        width: 360,
        height: 640,
        posterFrameIndex: 0,
        autoplayAfterTap: true,
        loopVideo: false,
        muteByDefault: true,
        backgroundColor: '#000000',
        clickThroughUrl: '',
        timeline: [],
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

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-73px)] p-8">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Upload your gameplay video</h1>
          <p className="text-gray-400">MP4 or WebM, up to 200 MB. The AI will find the best action moments automatically.</p>
        </div>

        <div
          className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all
            ${dragging ? 'border-indigo-400 bg-indigo-950/30' : 'border-gray-700 hover:border-gray-500 bg-gray-900/50'}`}
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-300">Uploading…</p>
            </div>
          ) : (
            <>
              <div className="text-5xl mb-4">🎮</div>
              <p className="text-lg font-medium mb-1">Drop video here</p>
              <p className="text-gray-500 text-sm">or click to browse</p>
            </>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-950 border border-red-800 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/webm"
          className="hidden"
          onChange={onInputChange}
        />

        <div className="mt-8 grid grid-cols-3 gap-4 text-center text-sm text-gray-500">
          <div>
            <div className="text-2xl mb-1">🔍</div>
            <p>Auto-detects action moments</p>
          </div>
          <div>
            <div className="text-2xl mb-1">⚡</div>
            <p>Server-side CV + AI analysis</p>
          </div>
          <div>
            <div className="text-2xl mb-1">📦</div>
            <p>Exports standalone HTML5 ad</p>
          </div>
        </div>
      </div>
    </div>
  );
}
