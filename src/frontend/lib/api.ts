import type { CreativeConfig, DetectActionsResponse } from './types';

const API_BASE = '';

export async function uploadVideo(file: File): Promise<{ sessionId: string; videoUrl: string; status: string }> {
  const form = new FormData();
  form.append('video', file);
  const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

export async function detectActions(
  sessionId: string,
  interval: number = 0.5,
  actionThreshold: number = 0.35,
  clusterGapSeconds: number = 1.5,
): Promise<DetectActionsResponse> {
  const res = await fetch(`${API_BASE}/api/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, interval, actionThreshold, clusterGapSeconds }),
  });
  if (!res.ok) throw new Error(`Detect actions failed: ${res.status}`);
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
