import { Env, Session, FrameAnalysis, CreativeConfig } from '../types';

const SESSION_TTL = 86400; // 24 hours

function defaultConfig(): CreativeConfig {
  return {
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
}

// --- Session CRUD ---

export async function createSession(env: Env, id: string, videoKey: string): Promise<Session> {
  const session: Session = {
    id,
    createdAt: new Date().toISOString(),
    videoKey,
    videoUrl: '',
    totalFrames: 0,
    analyzedFrames: 0,
    status: 'uploading',
    config: defaultConfig(),
  };
  await env.KV.put(`session:${id}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  return session;
}

export async function getSession(env: Env, id: string): Promise<Session | null> {
  const raw = await env.KV.get(`session:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function updateSession(env: Env, session: Session): Promise<void> {
  await env.KV.put(`session:${session.id}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
}

// --- Frame Analysis CRUD ---

export async function saveFrameAnalysis(env: Env, sessionId: string, analysis: FrameAnalysis): Promise<void> {
  await env.KV.put(
    `frame:${sessionId}:${analysis.frameIndex}`,
    JSON.stringify(analysis),
    { expirationTtl: SESSION_TTL },
  );
}

export async function getFrameAnalysis(env: Env, sessionId: string, frameIndex: number): Promise<FrameAnalysis | null> {
  const raw = await env.KV.get(`frame:${sessionId}:${frameIndex}`);
  return raw ? JSON.parse(raw) : null;
}

export async function getAllFrameAnalyses(env: Env, sessionId: string, totalFrames: number): Promise<FrameAnalysis[]> {
  const analyses: FrameAnalysis[] = [];
  for (let i = 0; i < totalFrames; i++) {
    const a = await getFrameAnalysis(env, sessionId, i);
    if (a) analyses.push(a);
  }
  return analyses;
}

// --- R2 Helpers ---

export async function uploadToR2(env: Env, key: string, data: ArrayBuffer | ReadableStream, contentType: string): Promise<void> {
  await env.R2.put(key, data, {
    httpMetadata: { contentType },
  });
}

export async function getR2Url(env: Env, key: string): Promise<string> {
  // In production this would be a custom domain or presigned URL.
  // For now, we serve through the worker at /api/files/:key
  return `/api/files/${encodeURIComponent(key)}`;
}

// --- Neuron Usage Tracking ---

export async function getDailyUsage(env: Env): Promise<number> {
  const date = new Date().toISOString().slice(0, 10);
  const raw = await env.KV.get(`usage:${date}`);
  return raw ? parseInt(raw, 10) : 0;
}

export async function incrementDailyUsage(env: Env, neurons: number): Promise<number> {
  const date = new Date().toISOString().slice(0, 10);
  const current = await getDailyUsage(env);
  const updated = current + neurons;
  await env.KV.put(`usage:${date}`, String(updated), { expirationTtl: 172800 }); // 48h TTL
  return updated;
}
