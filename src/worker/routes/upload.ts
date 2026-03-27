import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { Env, AppError } from '../types';
import { createSession, updateSession, uploadToR2, getR2Url } from '../services/storage';

const ACCEPTED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_SIZE = 100 * 1024 * 1024; // 100MB

const app = new Hono<{ Bindings: Env }>();

app.post('/', async (c) => {
  const contentType = c.req.header('content-type') || '';

  let videoBytes: ArrayBuffer;
  let ext = 'mp4';
  let mimeType = 'video/mp4';

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('video') as File | null;
    if (!file) throw new AppError('MISSING_VIDEO', 'No video file provided');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      throw new AppError('INVALID_TYPE', `Unsupported video type: ${file.type}. Accepted: mp4, webm, mov`);
    }
    if (file.size > MAX_SIZE) {
      throw new AppError('FILE_TOO_LARGE', 'Video must be under 100MB');
    }
    mimeType = file.type;
    ext = file.name.split('.').pop() || 'mp4';
    videoBytes = await file.arrayBuffer();
  } else {
    // Raw binary upload with query params
    const fileName = c.req.query('filename') || 'video.mp4';
    ext = fileName.split('.').pop() || 'mp4';
    videoBytes = await c.req.arrayBuffer();
    if (videoBytes.byteLength > MAX_SIZE) {
      throw new AppError('FILE_TOO_LARGE', 'Video must be under 100MB');
    }
  }

  const sessionId = nanoid(12);
  const videoKey = `videos/${sessionId}.${ext}`;

  // Upload to R2
  await uploadToR2(c.env, videoKey, videoBytes, mimeType);

  // Create session
  const session = await createSession(c.env, sessionId, videoKey);
  const videoUrl = await getR2Url(c.env, videoKey);
  session.videoUrl = videoUrl;
  session.status = 'extracting';
  await updateSession(c.env, session);

  return c.json({
    sessionId,
    videoUrl,
    status: session.status,
  });
});

export default app;
