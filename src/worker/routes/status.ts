import { Hono } from 'hono';
import { Env, AppError } from '../types';
import { getSession, getAllFrameAnalyses } from '../services/storage';

const app = new Hono<{ Bindings: Env }>();

app.get('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const session = await getSession(c.env, sessionId);
  if (!session) throw new AppError('SESSION_NOT_FOUND', 'Session not found', 404);

  const progress = session.totalFrames > 0
    ? session.analyzedFrames / session.totalFrames
    : 0;

  return c.json({
    sessionId: session.id,
    status: session.status,
    totalFrames: session.totalFrames,
    analyzedFrames: session.analyzedFrames,
    progress: Math.round(progress * 100) / 100,
  });
});

// Get all frame analyses for a session
app.get('/:sessionId/frames', async (c) => {
  const sessionId = c.req.param('sessionId');
  const session = await getSession(c.env, sessionId);
  if (!session) throw new AppError('SESSION_NOT_FOUND', 'Session not found', 404);

  const frames = await getAllFrameAnalyses(c.env, sessionId, session.analyzedFrames);
  return c.json({ sessionId, frames });
});

export default app;
