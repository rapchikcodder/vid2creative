import { useState, useCallback } from 'react';
import { analyzeFrame } from '../lib/api';
import type { ExtractedFrame } from '../lib/types';

const AI_CANDIDATES = 4;
const AI_CALL_DELAY_MS = 13000;
const MIN_ACTION_GAP = 2.0;

interface UseAIAnalysisReturn {
  aiStatus: 'idle' | 'running' | 'done';
  neurons: { dailyTotal: number; dailyLimit: number } | null;
  statusMsg: string;
  runAIAnalysis: (
    sessionId: string,
    allFrames: ExtractedFrame[],
    onFramesUpdated: (frames: ExtractedFrame[]) => void,
  ) => Promise<void>;
}

export function useAIAnalysis(): UseAIAnalysisReturn {
  const [aiStatus, setAiStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [neurons, setNeurons] = useState<{ dailyTotal: number; dailyLimit: number } | null>(null);
  const [statusMsg, setStatusMsg] = useState('');

  const runAIAnalysis = useCallback(async (
    sessionId: string,
    allFrames: ExtractedFrame[],
    onFramesUpdated: (frames: ExtractedFrame[]) => void,
  ) => {
    setAiStatus('running');
    const sorted = [...allFrames].sort((a, b) => (b.motionScore ?? 0) - (a.motionScore ?? 0));
    const candidates: ExtractedFrame[] = [];
    for (const f of sorted) {
      if (candidates.length >= AI_CANDIDATES) break;
      const tooClose = candidates.some(s => Math.abs(s.timestamp - f.timestamp) < MIN_ACTION_GAP);
      if (!tooClose) candidates.push(f);
    }

    const updated = [...allFrames];
    for (let i = 0; i < candidates.length; i++) {
      const f = candidates[i];
      setStatusMsg(`AI analyzing frame ${i + 1} / ${candidates.length}${i > 0 ? ' (pacing\u2026)' : '\u2026'}`);
      if (i > 0) await new Promise(r => setTimeout(r, AI_CALL_DELAY_MS));
      updated[f.index] = { ...updated[f.index], analysisStatus: 'analyzing' };
      onFramesUpdated([...updated]);
      try {
        const result = await analyzeFrame({
          sessionId, frameIndex: f.index,
          timestamp: f.timestamp, imageBase64: f.base64,
        });
        setNeurons(result.neurons);
        updated[f.index] = { ...updated[f.index], analysisStatus: 'done', analysis: result.analysis };
      } catch {
        updated[f.index] = { ...updated[f.index], analysisStatus: 'error' };
      }
      onFramesUpdated([...updated]);
    }
    setAiStatus('done');
  }, []);

  return { aiStatus, neurons, statusMsg, runAIAnalysis };
}
