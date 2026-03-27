import { Hono } from 'hono';
import { Env, AppError, CvCandidate, CvProcessResponse, AnalyzedCandidate, TimelineEvent, ProcessRequest, ProcessResponse } from '../types';
import { getSession, updateSession } from '../services/storage';
import { analyzeWithCvContext } from '../services/vision';
import { nanoid } from 'nanoid';

const app = new Hono<{ Bindings: Env }>();

const MIN_AI_CONFIRMED = 2;       // if AI confirms fewer, fall back to CV-high frames
const BUTTON_PRE_OFFSET = 2.5;    // seconds before detected frame to show button

app.post('/', async (c) => {
  const body = await c.req.json<ProcessRequest>();

  if (!body.sessionId) {
    throw new AppError('INVALID_REQUEST', 'Missing sessionId');
  }

  const session = await getSession(c.env, body.sessionId);
  if (!session) throw new AppError('SESSION_NOT_FOUND', 'Session not found', 404);

  const maxCandidates = body.maxCandidates ?? 5;
  const interval = body.interval ?? 1.0;

  // Build video URL for Container to download
  const videoObject = await c.env.R2.get(session.videoKey);
  if (!videoObject) throw new AppError('VIDEO_NOT_FOUND', 'Video not found in storage', 404);

  // Use /api/files route to serve the video to the Container
  // The Worker URL is reconstructed from the request
  const workerBase = new URL(c.req.url).origin;
  const videoUrl = `${workerBase}/api/files/${session.videoKey}`;

  // === Step 1: Call Container for CV processing ===
  const cvStart = Date.now();
  let cvResult: CvProcessResponse;

  try {
    const container = c.env.CV_PIPELINE.get(
      c.env.CV_PIPELINE.idFromName('cv-pipeline-singleton'),
    );
    const cvResp = await container.fetch(
      new Request('http://container/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_url: videoUrl,
          session_id: body.sessionId,
          max_candidates: maxCandidates,
          interval,
        }),
      }),
    );

    if (!cvResp.ok) {
      const errText = await cvResp.text();
      throw new AppError('CV_PIPELINE_ERROR', `CV pipeline returned ${cvResp.status}: ${errText}`, 503);
    }
    cvResult = await cvResp.json<CvProcessResponse>();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('CV_PIPELINE_UNREACHABLE', 'CV pipeline container is unavailable', 503);
  }

  const cvTimeMs = Date.now() - cvStart;

  // === Step 2: AI analysis for each candidate ===
  const aiStart = Date.now();
  const analyzedCandidates: AnalyzedCandidate[] = [];
  let aiCallCount = 0;

  for (const candidate of cvResult.candidates) {
    if (aiCallCount > 0) await new Promise(r => setTimeout(r, 8000)); // 8s between AI calls
    aiCallCount++;
    try {
      const analysis = await analyzeWithCvContext(c.env, candidate);
      analyzedCandidates.push({
        index: candidate.index,
        timestamp: candidate.timestamp,
        motion_score: candidate.motion_score,
        near_scene_boundary: candidate.near_scene_boundary,
        scene_type: candidate.scene_type,
        cv_confidence: candidate.cv_confidence,
        isAction: analysis.isAction,
        actionType: analysis.actionType,
        actionLabel: analysis.actionLabel,
        importance: analysis.importance,
        mood: analysis.mood,
        cta: analysis.cta,
        animationSuggestion: analysis.animationSuggestion,
      });
    } catch {
      // If AI fails for this frame, include it with isAction=false
      analyzedCandidates.push({
        index: candidate.index,
        timestamp: candidate.timestamp,
        motion_score: candidate.motion_score,
        near_scene_boundary: candidate.near_scene_boundary,
        scene_type: candidate.scene_type,
        cv_confidence: candidate.cv_confidence,
        isAction: false,
        actionType: 'none',
        actionLabel: '',
        importance: 5,
        mood: 'calm',
        cta: { text: 'Play Now', position: { x: 50, y: 80 }, style: 'primary', size: 'medium', visible: true, action: 'link' },
        animationSuggestion: 'fade-in',
      });
    }
  }

  const aiTimeMs = Date.now() - aiStart;

  // === Step 3: Build timeline events ===
  // AI-confirmed actions first, then fall back to CV-high if fewer than MIN_AI_CONFIRMED
  const aiConfirmed = analyzedCandidates.filter(c => c.isAction && c.importance >= 7);
  const useCandidates = aiConfirmed.length >= MIN_AI_CONFIRMED
    ? aiConfirmed
    : analyzedCandidates.sort((a, b) => b.cv_confidence - a.cv_confidence);

  const timeline: TimelineEvent[] = useCandidates.map((candidate) => ({
    id: nanoid(8),
    frameIndex: candidate.index,
    timestamp: Math.max(0, Math.round((candidate.timestamp - BUTTON_PRE_OFFSET) * 10) / 10),
    duration: 0.6,
    cta: candidate.cta,
    overlay: { type: 'none', text: '', position: 'top-right', visible: false },
    animation: candidate.animationSuggestion,
    pauseVideo: true,
  }));

  // === Step 4: Update session status ===
  session.status = 'ready';
  session.totalFrames = cvResult.total_frames_extracted;
  await updateSession(c.env, session);

  const totalTimeMs = Date.now() - cvStart;

  const response: ProcessResponse = {
    sessionId: body.sessionId,
    totalFramesExtracted: cvResult.total_frames_extracted,
    sceneBoundaries: cvResult.scene_boundaries_found,
    candidates: analyzedCandidates,
    timeline,
    processingTimeMs: totalTimeMs,
    cvProcessingTimeMs: cvTimeMs,
    aiProcessingTimeMs: aiTimeMs,
  };

  return c.json(response);
});

export default app;
