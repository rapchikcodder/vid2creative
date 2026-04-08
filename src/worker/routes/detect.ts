import { Hono } from 'hono';
import { Env, AppError, DetectActionsRequest, DetectActionsResponse, CvScoredFrame, CvActionCluster } from '../types';
import { getSession } from '../services/storage';

const app = new Hono<{ Bindings: Env }>();

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000; // 5s between retries (container cold start can take 10-15s)

/**
 * POST /api/detect — ML action detection (zero AI neurons).
 * Proxies to the Python CV container's /detect-actions endpoint.
 * Retries on container cold-start failures.
 */
app.post('/', async (c) => {
  const body = await c.req.json<DetectActionsRequest>();

  if (!body.sessionId) {
    throw new AppError('INVALID_REQUEST', 'Missing sessionId');
  }

  const session = await getSession(c.env, body.sessionId);
  if (!session) throw new AppError('SESSION_NOT_FOUND', 'Session not found', 404);

  const videoObject = await c.env.R2.get(session.videoKey);
  if (!videoObject) throw new AppError('VIDEO_NOT_FOUND', 'Video not found in storage', 404);

  const workerBase = new URL(c.req.url).origin;
  const videoUrl = `${workerBase}/api/files/${session.videoKey}`;

  const interval = body.interval ?? 0.5;
  const actionThreshold = body.actionThreshold ?? 0.35;
  const clusterGapSeconds = body.clusterGapSeconds ?? 1.5;

  const start = Date.now();
  const container = c.env.CV_PIPELINE.get(
    c.env.CV_PIPELINE.idFromName('cv-pipeline-singleton'),
  );

  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[detect] Retry ${attempt}/${MAX_RETRIES} after container error...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }

    try {
      const cvResp = await container.fetch(
        new Request('http://container/detect-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_url: videoUrl,
            session_id: body.sessionId,
            interval,
            action_threshold: actionThreshold,
            cluster_gap_seconds: clusterGapSeconds,
          }),
        }),
      );

      if (!cvResp.ok) {
        const errText = await cvResp.text();
        lastErr = new Error(`CV pipeline returned ${cvResp.status}: ${errText}`);
        continue; // retry
      }

      const cvResult = await cvResp.json<{
        session_id: string;
        total_frames_extracted: number;
        scene_boundaries_found: number;
        action_count: number;
        action_clusters: CvActionCluster[];
        all_scores: CvScoredFrame[];
        focus_x: number;
        processing_time_ms: number;
      }>();

      const totalTimeMs = Date.now() - start;

      const response: DetectActionsResponse = {
        sessionId: body.sessionId,
        totalFramesExtracted: cvResult.total_frames_extracted,
        sceneBoundaries: cvResult.scene_boundaries_found,
        actionCount: cvResult.action_count,
        actionClusters: cvResult.action_clusters,
        allScores: cvResult.all_scores,
        focusX: cvResult.focus_x,
        processingTimeMs: totalTimeMs,
      };

      return c.json(response);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.error(`[detect] Attempt ${attempt + 1} failed:`, lastErr.message);
      continue; // retry on network/container errors
    }
  }

  // All retries exhausted
  throw new AppError(
    'CV_PIPELINE_UNREACHABLE',
    `Container unavailable after ${MAX_RETRIES} attempts: ${lastErr?.message}`,
    503,
  );
});

export default app;
