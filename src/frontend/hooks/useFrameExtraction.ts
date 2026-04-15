import { useState, useRef, useCallback } from 'react';
import type { ExtractedFrame } from '../lib/types';

const DIFF_SIZE = 64;

function computeMotionScore(
  ctx: CanvasRenderingContext2D,
  prevData: Uint8ClampedArray | null,
  fullCanvas: HTMLCanvasElement,
): { score: number; pixelData: Uint8ClampedArray } {
  ctx.drawImage(fullCanvas, 0, 0, DIFF_SIZE, DIFF_SIZE);
  const img = ctx.getImageData(0, 0, DIFF_SIZE, DIFF_SIZE);
  const data = img.data;
  if (!prevData) return { score: 0, pixelData: data };
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = Math.abs(data[i] - prevData[i]);
    const g = Math.abs(data[i + 1] - prevData[i + 1]);
    const b = Math.abs(data[i + 2] - prevData[i + 2]);
    total += (r + g + b) / 3;
  }
  return { score: total / (DIFF_SIZE * DIFF_SIZE * 255), pixelData: data };
}

const MAX_ACTIONS = 6;
const MIN_ACTION_GAP = 2.0;

interface UseFrameExtractionReturn {
  frames: ExtractedFrame[];
  framesRef: React.MutableRefObject<ExtractedFrame[]>;
  progress: number;
  statusMsg: string;
  isExtracting: boolean;
  setFrames: React.Dispatch<React.SetStateAction<ExtractedFrame[]>>;
  startExtraction: (
    videoFile: File,
    intervalSec: number,
    canvasRef: React.RefObject<HTMLCanvasElement | null>,
    diffCanvasRef: React.RefObject<HTMLCanvasElement | null>,
  ) => Promise<ExtractedFrame[]>;
}

export function useFrameExtraction(): UseFrameExtractionReturn {
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const framesRef = useRef<ExtractedFrame[]>([]);

  const startExtraction = useCallback(async (
    videoFile: File,
    intervalSec: number,
    canvasRef: React.RefObject<HTMLCanvasElement | null>,
    diffCanvasRef: React.RefObject<HTMLCanvasElement | null>,
  ): Promise<ExtractedFrame[]> => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.preload = 'auto';
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Video load failed'));
    });
    const duration = video.duration;
    const timestamps: number[] = [];
    for (let t = 0; t < duration; t += intervalSec) timestamps.push(t);

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const diffCanvas = diffCanvasRef.current!;
    const diffCtx = diffCanvas.getContext('2d', { willReadFrequently: true })!;
    canvas.width = 640;
    canvas.height = Math.round(640 * (video.videoHeight / video.videoWidth));
    diffCanvas.width = DIFF_SIZE;
    diffCanvas.height = DIFF_SIZE;

    setIsExtracting(true);
    const extracted: ExtractedFrame[] = [];
    let prevData: Uint8ClampedArray | null = null;

    for (let i = 0; i < timestamps.length; i++) {
      setProgress(Math.round((i / timestamps.length) * 100));
      setStatusMsg(`Extracting frame ${i + 1} / ${timestamps.length}`);
      video.currentTime = timestamps[i];
      await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { score, pixelData } = computeMotionScore(diffCtx, prevData, canvas);
      prevData = pixelData;
      const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.8));
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });
      extracted.push({
        index: i, timestamp: timestamps[i], blob, base64,
        thumbnailUrl: URL.createObjectURL(blob),
        analysisStatus: 'pending', motionScore: score,
      });
    }
    URL.revokeObjectURL(video.src);

    // Browser-side smart action selection using motion spikes
    const scores = extracted.map(f => f.motionScore ?? 0);
    const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
    const variance = scores.reduce((a, s) => a + (s - mean) ** 2, 0) / (scores.length || 1);
    const stddev = Math.sqrt(variance);
    const dynamicThreshold = Math.max(mean + 0.5 * stddev, 0.12);

    const accel = scores.map((s, i) => i === 0 ? 0 : Math.max(0, s - scores[i - 1]));
    const accelMean = accel.reduce((a, b) => a + b, 0) / (accel.length || 1);
    const accelStd = Math.sqrt(accel.reduce((a, s) => a + (s - accelMean) ** 2, 0) / (accel.length || 1));

    const ranked = extracted.map((f, i) => {
      const motionAbove = Math.max(0, (f.motionScore ?? 0) - dynamicThreshold);
      const spikeScore = accel[i] > accelMean + accelStd ? accel[i] : 0;
      return { frame: f, rank: motionAbove * 0.6 + spikeScore * 0.4 };
    }).filter(r => r.rank > 0).sort((a, b) => b.rank - a.rank);

    const initialPicks: ExtractedFrame[] = [];
    for (const { frame } of ranked) {
      if (initialPicks.length >= MAX_ACTIONS) break;
      const tooClose = initialPicks.some(s => Math.abs(s.timestamp - frame.timestamp) < MIN_ACTION_GAP);
      if (!tooClose) initialPicks.push(frame);
    }
    const pickSet = new Set(initialPicks.map(f => f.index));
    const withSelection = extracted.map(f => ({
      ...f,
      isSelected: pickSet.has(f.index),
      refinedTimestamp: Math.max(0, f.timestamp - 2.5),
    }));

    framesRef.current = withSelection;
    setFrames(withSelection);
    setProgress(100);
    setIsExtracting(false);
    setStatusMsg('Frames ready! Running ML detection in background\u2026');

    return withSelection;
  }, []);

  return { frames, framesRef, progress, statusMsg, isExtracting, setFrames, startExtraction };
}
