import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Container } from '@cloudflare/containers';
import { Env, AppError } from './types';
import uploadRoute from './routes/upload';
import analyzeRoute from './routes/analyze';
import statusRoute from './routes/status';
import exportRoute from './routes/export';
import processRoute from './routes/process';

// Python CV container — FastAPI + FFmpeg + OpenCV
export class CvPipeline extends Container {
  defaultPort = 8080;
}

const app = new Hono<{ Bindings: Env }>();

// CORS for frontend dev server
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type'],
}));

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', version: '2.0.0', container: 'enabled' });
});

// API routes
app.route('/api/upload', uploadRoute);
app.route('/api/analyze', analyzeRoute);   // kept for backward compat
app.route('/api/status', statusRoute);
app.route('/api/export', exportRoute);
app.route('/api/process', processRoute);   // v2.0 full pipeline

// Serve R2 files (frames, videos, exports)
app.get('/api/files/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.R2.get(key);
  if (!object) return c.notFound();

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=3600');

  return new Response(object.body, { headers });
});

// Update session totalFrames (called by frontend after extraction)
app.put('/api/session/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json<{ totalFrames?: number; status?: string }>();

  const raw = await c.env.KV.get(`session:${sessionId}`);
  if (!raw) throw new AppError('SESSION_NOT_FOUND', 'Session not found', 404);

  const session = JSON.parse(raw);
  if (body.totalFrames !== undefined) session.totalFrames = body.totalFrames;
  if (body.status) session.status = body.status;
  await c.env.KV.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: 86400 });

  return c.json({ success: true, session });
});

// Debug: test vision model raw response with full error details
app.post('/api/debug/vision', async (c) => {
  const body = await c.req.json<{ imageBase64: string }>();
  const imageBytes = Uint8Array.from(atob(body.imageBase64), (ch) => ch.charCodeAt(0));
  const imageArray = [...imageBytes];

  // First ensure model is agreed
  await c.env.KV.put('meta:model_agreed', 'true');

  // Try multiple formats to find what works
  const formats: Record<string, any> = {
    prompt_image: {
      prompt: 'Describe what you see in this image in 2 sentences.',
      image: imageArray,
      max_tokens: 256,
    },
    messages_image: {
      messages: [{ role: 'user', content: 'Describe what you see in this image in 2 sentences.' }],
      image: imageArray,
      max_tokens: 256,
    },
  };

  const results: Record<string, any> = {};
  for (const [name, input] of Object.entries(formats)) {
    try {
      const r = await c.env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct' as any, input);
      results[name] = { ok: true, raw: r };
    } catch (err: any) {
      results[name] = { ok: false, error: err.message };
    }
  }
  return c.json(results);
});

// Global error handler
app.onError((err, c) => {
  console.error(`[${c.req.method} ${c.req.path}]`, err);
  if (err instanceof AppError) {
    return c.json({ error: err.code, message: err.message }, err.status as any);
  }
  return c.json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }, 500);
});

export default app;
