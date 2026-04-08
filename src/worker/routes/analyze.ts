import { Hono } from 'hono';
import { Env, AppError, FrameAnalysis } from '../types';
import { getSession, updateSession, saveFrameAnalysis, uploadToR2, getDailyUsage, incrementDailyUsage } from '../services/storage';
import { analyzeFrame } from '../services/vision';

const DAILY_NEURON_LIMIT = 5000;
const WARNING_THRESHOLD = 0.8;
const MAX_FRAMES_PER_SESSION = 200;

const app = new Hono<{ Bindings: Env }>();

app.post('/', async (c) => {
  const body = await c.req.json<{
    sessionId: string;
    frameIndex: number;
    timestamp: number;
    imageBase64: string;
    isRefinement?: boolean;
  }>();

  if (!body.sessionId || body.frameIndex === undefined || !body.imageBase64) {
    throw new AppError('INVALID_REQUEST', 'Missing required fields: sessionId, frameIndex, imageBase64');
  }

  // Check session
  const session = await getSession(c.env, body.sessionId);
  if (!session) throw new AppError('SESSION_NOT_FOUND', 'Session not found', 404);

  // Skip frame limit for refinement sub-frames (they use indices 1000+)
  if (!body.isRefinement && session.analyzedFrames >= MAX_FRAMES_PER_SESSION) {
    throw new AppError('FRAME_LIMIT', `Max ${MAX_FRAMES_PER_SESSION} frames per session`);
  }

  // Check neuron budget
  const currentUsage = await getDailyUsage(c.env);
  if (currentUsage >= DAILY_NEURON_LIMIT) {
    throw new AppError('RATE_LIMITED', 'Daily limit of 5,000 neurons reached. Resets at midnight UTC.', 429);
  }

  // Decode base64 image
  const imageBytes = Uint8Array.from(atob(body.imageBase64), (ch) => ch.charCodeAt(0));

  // Analyze with vision model
  let analysisResult: Awaited<ReturnType<typeof analyzeFrame>>;
  try {
    analysisResult = await analyzeFrame(c.env, imageBytes, !!body.isRefinement);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many')) {
      throw new AppError('RATE_LIMITED', 'Workers AI vision model rate limit reached. Please wait a minute and retry.', 429);
    }
    throw err;
  }
  const { analysis, neurons, rawResponse } = analysisResult;

  let thumbnailKey = '';

  if (body.isRefinement) {
    // Refinement sub-frames: skip R2 storage and session counter update
    thumbnailKey = `frames/${body.sessionId}/ref_${body.frameIndex}.jpg`;
  } else {
    // Normal frames: store to R2 and update session
    thumbnailKey = `frames/${body.sessionId}/${body.frameIndex}.jpg`;
    await uploadToR2(c.env, thumbnailKey, imageBytes.buffer, 'image/jpeg');

    await saveFrameAnalysis(c.env, body.sessionId, {
      frameIndex: body.frameIndex,
      timestamp: body.timestamp,
      thumbnailKey,
      ...analysis,
    });

    session.analyzedFrames = Math.max(session.analyzedFrames, body.frameIndex + 1);
    if (session.status !== 'ready') session.status = 'analyzing';
    await updateSession(c.env, session);
  }

  // Build full FrameAnalysis for response
  const frameAnalysis: FrameAnalysis = {
    frameIndex: body.frameIndex,
    timestamp: body.timestamp,
    thumbnailKey,
    ...analysis,
  };

  // Track neurons
  const updatedUsage = await incrementDailyUsage(c.env, neurons);
  const usageWarning = updatedUsage >= DAILY_NEURON_LIMIT * WARNING_THRESHOLD;

  return c.json({
    frameIndex: body.frameIndex,
    analysis: frameAnalysis,
    rawResponse,
    neurons: {
      used: neurons,
      dailyTotal: updatedUsage,
      dailyLimit: DAILY_NEURON_LIMIT,
      warning: usageWarning,
    },
  });
});

export default app;
