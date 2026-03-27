import type { Session, FrameAnalysis, CreativeConfig, ProcessResponse } from './types';

const API_BASE = '';

export async function uploadVideo(file: File): Promise<{ sessionId: string; videoUrl: string; status: string }> {
  const form = new FormData();
  form.append('video', file);
  const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

export async function analyzeFrame(params: {
  sessionId: string;
  frameIndex: number;
  timestamp: number;
  imageBase64: string;
  isRefinement?: boolean;
}): Promise<{ frameIndex: number; analysis: FrameAnalysis; rawResponse: string; neurons: { used: number; dailyTotal: number; dailyLimit: number; warning: boolean } }> {
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [15000, 30000]; // 15s, 30s — must wait for rate-limit window reset
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]));
    const res = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.status === 429) { lastErr = new Error('Analyze failed: 429'); continue; }
    if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
    return res.json();
  }
  throw lastErr ?? new Error('Analyze failed after retries');
}

export async function processVideo(
  sessionId: string,
  maxCandidates: number = 5,
  interval: number = 1.0,
): Promise<ProcessResponse> {
  const res = await fetch(`${API_BASE}/api/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, maxCandidates, interval }),
  });
  if (!res.ok) throw new Error(`Process failed: ${res.status}`);
  return res.json();
}

export async function getSession(sessionId: string): Promise<Session> {
  const res = await fetch(`${API_BASE}/api/status/${sessionId}`);
  if (!res.ok) throw new Error(`Status failed: ${res.status}`);
  return res.json();
}

export async function updateSession(sessionId: string, data: Partial<Session>): Promise<Session> {
  const res = await fetch(`${API_BASE}/api/session/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Update session failed: ${res.status}`);
  return res.json();
}

export async function exportCreative(sessionId: string, config: CreativeConfig): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, config }),
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return res.blob();
}
