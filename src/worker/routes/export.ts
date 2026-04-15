import { Hono } from 'hono';
import { Env, AppError, CreativeConfig } from '../types';
import { getSession, updateSession, uploadToR2 } from '../services/storage';
import { generateCreativeHtml } from '../services/html-generator';

const app = new Hono<{ Bindings: Env }>();

app.post('/', async (c) => {
  const body = await c.req.json<{
    sessionId: string;
    config: CreativeConfig;
  }>();

  if (!body.sessionId) throw new AppError('INVALID_REQUEST', 'Missing sessionId');

  const session = await getSession(c.env, body.sessionId);
  if (!session) throw new AppError('SESSION_NOT_FOUND', 'Session not found', 404);

  // Merge provided config with session config
  const config: CreativeConfig = { ...session.config, ...body.config };

  // Build absolute URLs so the exported HTML works as a standalone file
  const origin = new URL(c.req.url).origin;
  const videoUrl = `${origin}/api/files/${encodeURIComponent(session.videoKey)}`;
  const posterKey = `frames/${session.id}/${config.posterFrameIndex}.jpg`;
  // Gracefully handle missing poster (frame never analyzed due to rate limits)
  const posterExists = await c.env.R2.head(posterKey);
  const posterUrl = posterExists ? `${origin}/api/files/${encodeURIComponent(posterKey)}` : '';

  // Generate HTML
  const html = generateCreativeHtml(config, videoUrl, posterUrl);

  // Store export in R2
  const exportKey = `exports/${session.id}/creative.html`;
  await uploadToR2(c.env, exportKey, new TextEncoder().encode(html).buffer, 'text/html');

  // Update session config
  session.config = config;
  session.status = 'ready';
  await updateSession(c.env, session);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="creative-${session.id}.html"`,
    },
  });
});

// Save config without exporting
app.put('/config', async (c) => {
  const body = await c.req.json<{ sessionId: string; config: Partial<CreativeConfig> }>();
  const session = await getSession(c.env, body.sessionId);
  if (!session) throw new AppError('SESSION_NOT_FOUND', 'Session not found', 404);

  session.config = { ...session.config, ...body.config };
  await updateSession(c.env, session);

  return c.json({ success: true, config: session.config });
});

export default app;
