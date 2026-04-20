import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- storage.ts tests ----
import {
  createSession,
  getSession,
  updateSession,
  saveFrameAnalysis,
  getFrameAnalysis,
  getAllFrameAnalyses,
  uploadToR2,
  getR2Url,
  getDailyUsage,
  incrementDailyUsage,
} from '../services/storage';

// ---- html-generator.ts tests ----
import { generateCreativeHtml } from '../services/html-generator';

// ---- vision.ts tests ----
import { analyzeFrame, analyzeWithCvContext } from '../services/vision';

// ---- Types ----
import type { Env, Session, FrameAnalysis, CreativeConfig, TimelineEvent, CvCandidate } from '../types';

// ---------------------------------------------------------------------------
// Helpers: mock Env
// ---------------------------------------------------------------------------

function createMockEnv(): Env {
  return {
    KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace,
    R2: {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
    } as unknown as R2Bucket,
    AI: {
      run: vi.fn().mockResolvedValue({ response: '' }),
    } as unknown as Ai,
    CV_PIPELINE: {} as DurableObjectNamespace,
  };
}

// Shorthand cast for mock access
const kv = (env: Env) => env.KV as unknown as { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
const r2 = (env: Env) => env.R2 as unknown as { put: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
const ai = (env: Env) => env.AI as unknown as { run: ReturnType<typeof vi.fn> };

// ---------------------------------------------------------------------------
// storage.ts
// ---------------------------------------------------------------------------

describe('storage.ts', () => {
  let env: Env;

  beforeEach(() => {
    env = createMockEnv();
  });

  // --- createSession ---

  describe('createSession', () => {
    it('returns a Session with status "uploading" and correct fields', async () => {
      const session = await createSession(env, 'sess-1', 'videos/test.mp4');

      expect(session.id).toBe('sess-1');
      expect(session.videoKey).toBe('videos/test.mp4');
      expect(session.status).toBe('uploading');
      expect(session.videoUrl).toBe('');
      expect(session.totalFrames).toBe(0);
      expect(session.analyzedFrames).toBe(0);
      expect(session.createdAt).toBeTruthy();
      // Default config values
      expect(session.config.width).toBe(360);
      expect(session.config.height).toBe(640);
      expect(session.config.posterFrameIndex).toBe(0);
      expect(session.config.autoplayAfterTap).toBe(true);
      expect(session.config.loopVideo).toBe(false);
      expect(session.config.muteByDefault).toBe(true);
      expect(session.config.backgroundColor).toBe('#000000');
      expect(session.config.clickThroughUrl).toBe('');
      expect(session.config.timeline).toEqual([]);
    });

    it('stores the session in KV with SESSION_TTL (86400)', async () => {
      await createSession(env, 'sess-2', 'videos/test.mp4');

      expect(kv(env).put).toHaveBeenCalledWith(
        'session:sess-2',
        expect.any(String),
        { expirationTtl: 86400 },
      );

      // Verify the stored payload is valid JSON matching the session
      const storedJson = kv(env).put.mock.calls[0][1];
      const stored = JSON.parse(storedJson);
      expect(stored.id).toBe('sess-2');
      expect(stored.status).toBe('uploading');
    });
  });

  // --- getSession ---

  describe('getSession', () => {
    it('returns null when the session does not exist in KV', async () => {
      kv(env).get.mockResolvedValue(null);
      const result = await getSession(env, 'nonexistent');
      expect(result).toBeNull();
      expect(kv(env).get).toHaveBeenCalledWith('session:nonexistent');
    });

    it('returns parsed session when KV has data', async () => {
      const session: Session = {
        id: 'sess-3',
        createdAt: '2026-01-01T00:00:00.000Z',
        videoKey: 'vid.mp4',
        videoUrl: '/api/files/vid.mp4',
        totalFrames: 10,
        analyzedFrames: 5,
        status: 'analyzing',
        config: {
          width: 360,
          height: 640,
          posterFrameIndex: 0,
          autoplayAfterTap: true,
          loopVideo: false,
          muteByDefault: true,
          backgroundColor: '#000000',
          clickThroughUrl: '',
          timeline: [],
          layers: [],
        },
      };
      kv(env).get.mockResolvedValue(JSON.stringify(session));

      const result = await getSession(env, 'sess-3');
      expect(result).toEqual(session);
    });
  });

  // --- updateSession ---

  describe('updateSession', () => {
    it('stores the session using session.id as part of the key with TTL', async () => {
      const session: Session = {
        id: 'sess-4',
        createdAt: '2026-01-01T00:00:00.000Z',
        videoKey: 'vid.mp4',
        videoUrl: '',
        totalFrames: 20,
        analyzedFrames: 20,
        status: 'ready',
        config: {
          width: 360,
          height: 640,
          posterFrameIndex: 0,
          autoplayAfterTap: true,
          loopVideo: false,
          muteByDefault: true,
          backgroundColor: '#000000',
          clickThroughUrl: '',
          timeline: [],
          layers: [],
        },
      };

      await updateSession(env, session);

      expect(kv(env).put).toHaveBeenCalledWith(
        'session:sess-4',
        JSON.stringify(session),
        { expirationTtl: 86400 },
      );
    });
  });

  // --- Frame Analysis CRUD ---

  describe('saveFrameAnalysis', () => {
    it('stores frame analysis with correct key and TTL', async () => {
      const analysis: FrameAnalysis = {
        frameIndex: 3,
        timestamp: 1.5,
        thumbnailKey: 'thumb-3.jpg',
        sceneType: 'gameplay',
        description: 'Character running',
        mood: 'exciting',
        importance: 5,
        isAction: false,
        actionType: 'none',
        actionLabel: '',
        cta: { text: 'Play', position: { x: 50, y: 80 }, style: 'primary', size: 'medium', visible: true, action: 'link' },
        overlay: { type: 'none', text: '', position: 'top-right', visible: false },
        animationSuggestion: 'fade-in',
      };

      await saveFrameAnalysis(env, 'sess-5', analysis);

      expect(kv(env).put).toHaveBeenCalledWith(
        'frame:sess-5:3',
        JSON.stringify(analysis),
        { expirationTtl: 86400 },
      );
    });
  });

  describe('getFrameAnalysis', () => {
    it('returns null when frame analysis does not exist', async () => {
      kv(env).get.mockResolvedValue(null);
      const result = await getFrameAnalysis(env, 'sess-6', 0);
      expect(result).toBeNull();
      expect(kv(env).get).toHaveBeenCalledWith('frame:sess-6:0');
    });

    it('returns parsed FrameAnalysis when KV has data', async () => {
      const analysis: FrameAnalysis = {
        frameIndex: 0,
        timestamp: 0,
        thumbnailKey: 'thumb-0.jpg',
        sceneType: 'title',
        description: 'Title screen',
        mood: 'calm',
        importance: 3,
        isAction: false,
        actionType: 'none',
        actionLabel: '',
        cta: { text: 'Start', position: { x: 50, y: 80 }, style: 'primary', size: 'medium', visible: true, action: 'link' },
        overlay: { type: 'none', text: '', position: 'top-right', visible: false },
        animationSuggestion: 'fade-in',
      };
      kv(env).get.mockResolvedValue(JSON.stringify(analysis));

      const result = await getFrameAnalysis(env, 'sess-7', 0);
      expect(result).toEqual(analysis);
    });
  });

  describe('getAllFrameAnalyses', () => {
    it('returns all frame analyses that exist in KV', async () => {
      const frame0: FrameAnalysis = {
        frameIndex: 0, timestamp: 0, thumbnailKey: 'th0', sceneType: 'title',
        description: 'title', mood: 'calm', importance: 3, isAction: false,
        actionType: 'none', actionLabel: '',
        cta: { text: 'Play', position: { x: 50, y: 80 }, style: 'primary', size: 'medium', visible: true, action: 'link' },
        overlay: { type: 'none', text: '', position: 'top-right', visible: false },
        animationSuggestion: 'fade-in',
      };
      const frame2: FrameAnalysis = { ...frame0, frameIndex: 2, timestamp: 1 };

      kv(env).get.mockImplementation(async (key: string) => {
        if (key === 'frame:sess-8:0') return JSON.stringify(frame0);
        if (key === 'frame:sess-8:2') return JSON.stringify(frame2);
        return null;
      });

      const results = await getAllFrameAnalyses(env, 'sess-8', 3);
      expect(results).toHaveLength(2);
      expect(results[0].frameIndex).toBe(0);
      expect(results[1].frameIndex).toBe(2);
    });

    it('returns empty array when no frames exist', async () => {
      kv(env).get.mockResolvedValue(null);
      const results = await getAllFrameAnalyses(env, 'sess-9', 5);
      expect(results).toEqual([]);
    });
  });

  // --- R2 Helpers ---

  describe('uploadToR2', () => {
    it('calls R2.put with key, data, and contentType metadata', async () => {
      const data = new ArrayBuffer(8);
      await uploadToR2(env, 'videos/test.mp4', data, 'video/mp4');

      expect(r2(env).put).toHaveBeenCalledWith('videos/test.mp4', data, {
        httpMetadata: { contentType: 'video/mp4' },
      });
    });
  });

  describe('getR2Url', () => {
    it('returns /api/files/ prefixed path with encoded key', async () => {
      const url = await getR2Url(env, 'videos/my file.mp4');
      expect(url).toBe('/api/files/videos%2Fmy%20file.mp4');
    });

    it('returns correctly for simple keys', async () => {
      const url = await getR2Url(env, 'test.mp4');
      expect(url).toBe('/api/files/test.mp4');
    });
  });

  // --- Daily Usage Tracking ---

  describe('getDailyUsage', () => {
    it('returns 0 when no usage data exists', async () => {
      kv(env).get.mockResolvedValue(null);
      const result = await getDailyUsage(env);
      expect(result).toBe(0);
    });

    it('returns the stored usage number', async () => {
      const date = new Date().toISOString().slice(0, 10);
      kv(env).get.mockImplementation(async (key: string) => {
        if (key === `usage:${date}`) return '42';
        return null;
      });

      const result = await getDailyUsage(env);
      expect(result).toBe(42);
    });

    it('uses the correct date-based key format', async () => {
      await getDailyUsage(env);
      const date = new Date().toISOString().slice(0, 10);
      expect(kv(env).get).toHaveBeenCalledWith(`usage:${date}`);
    });
  });

  describe('incrementDailyUsage', () => {
    it('increments from 0 when no previous usage', async () => {
      kv(env).get.mockResolvedValue(null);
      const result = await incrementDailyUsage(env, 66);
      expect(result).toBe(66);
    });

    it('adds to existing usage', async () => {
      const date = new Date().toISOString().slice(0, 10);
      kv(env).get.mockImplementation(async (key: string) => {
        if (key === `usage:${date}`) return '100';
        return null;
      });

      const result = await incrementDailyUsage(env, 33);
      expect(result).toBe(133);
    });

    it('stores with 48h TTL (172800)', async () => {
      kv(env).get.mockResolvedValue(null);
      await incrementDailyUsage(env, 10);

      const date = new Date().toISOString().slice(0, 10);
      expect(kv(env).put).toHaveBeenCalledWith(
        `usage:${date}`,
        '10',
        { expirationTtl: 172800 },
      );
    });
  });
});

// ---------------------------------------------------------------------------
// html-generator.ts
// ---------------------------------------------------------------------------

describe('html-generator.ts', () => {
  function baseConfig(overrides: Partial<CreativeConfig> = {}): CreativeConfig {
    return {
      width: 360,
      height: 640,
      posterFrameIndex: 0,
      autoplayAfterTap: true,
      loopVideo: false,
      muteByDefault: true,
      backgroundColor: '#000000',
      clickThroughUrl: 'https://example.com',
      timeline: [],
      layers: [],
      ...overrides,
    };
  }

  describe('basic HTML structure', () => {
    it('contains a <video> tag with the correct src', () => {
      const html = generateCreativeHtml(baseConfig(), 'https://cdn.example.com/video.mp4', 'https://cdn.example.com/poster.jpg');
      expect(html).toContain('<source src="https://cdn.example.com/video.mp4" type="video/mp4">');
    });

    it('contains the poster frame URL in video poster attribute', () => {
      const html = generateCreativeHtml(baseConfig(), 'https://cdn.example.com/video.mp4', 'https://cdn.example.com/poster.jpg');
      expect(html).toContain('poster="https://cdn.example.com/poster.jpg"');
    });

    it('contains the poster overlay div with background-image', () => {
      const html = generateCreativeHtml(baseConfig(), 'https://cdn.example.com/video.mp4', 'https://cdn.example.com/poster.jpg');
      expect(html).toContain("background-image:url('https://cdn.example.com/poster.jpg')");
    });

    it('sets the correct creative dimensions', () => {
      const config = baseConfig({ width: 480, height: 720 });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).toContain('width:480px');
      expect(html).toContain('height:720px');
    });

    it('sets the background color', () => {
      const config = baseConfig({ backgroundColor: '#ff0000' });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).toContain('background:#ff0000');
    });

    it('is valid HTML5 with doctype', () => {
      const html = generateCreativeHtml(baseConfig(), 'v.mp4', 'p.jpg');
      expect(html).toMatch(/^<!DOCTYPE html>/);
      expect(html).toContain('</html>');
    });
  });

  describe('video attributes', () => {
    it('adds muted attribute when muteByDefault is true', () => {
      const config = baseConfig({ muteByDefault: true });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).toMatch(/<video[^>]*\bmuted\b/);
    });

    it('does not add muted attribute when muteByDefault is false', () => {
      const config = baseConfig({ muteByDefault: false });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      // The muted attribute should be an empty string, not present as a keyword
      expect(html).toMatch(/<video[^>]*\bplaysinline\b/);
      // Check the muted position is empty
      const videoTag = html.match(/<video[^>]*>/)?.[0] || '';
      expect(videoTag).not.toMatch(/\bmuted\b/);
    });

    it('adds loop attribute when loopVideo is true', () => {
      const config = baseConfig({ loopVideo: true });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).toMatch(/<video[^>]*\bloop\b/);
    });

    it('does not add loop attribute when loopVideo is false', () => {
      const config = baseConfig({ loopVideo: false });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      const videoTag = html.match(/<video[^>]*>/)?.[0] || '';
      expect(videoTag).not.toMatch(/\bloop\b/);
    });
  });

  describe('focusX (object-position for smart crop)', () => {
    it('defaults to 50% when focusX is not set', () => {
      const config = baseConfig();
      delete config.focusX;
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).toContain('object-position:50% 50%');
    });

    it('applies custom focusX to object-position', () => {
      const config = baseConfig({ focusX: 30 });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).toContain('object-position:30% 50%');
    });

    it('applies focusX to poster overlay background-position as well', () => {
      const config = baseConfig({ focusX: 75 });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).toContain('background-position:75% 50%');
    });
  });

  describe('default CTA', () => {
    it('adds default "Play Now" CTA when timeline has no poster events', () => {
      const config = baseConfig({ timeline: [], posterFrameIndex: 0 });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).toContain('Play Now');
      expect(html).toContain('class="cta-btn poster-cta large pulse anim-pulse"');
    });

    it('does not add default CTA when poster events exist', () => {
      const event: TimelineEvent = {
        id: 'e1',
        frameIndex: 0,  // matches posterFrameIndex
        timestamp: 0,
        duration: 3,
        cta: { text: 'Custom CTA', position: { x: 50, y: 70 }, style: 'glow', size: 'large', visible: true, action: 'link' },
        overlay: { type: 'none', text: '', position: 'top-right', visible: false },
        animation: 'bounce',
        pauseVideo: false,
      };
      const config = baseConfig({ timeline: [event], posterFrameIndex: 0 });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).toContain('Custom CTA');
      // The default CTA string "Play Now" with specific pulse class may still appear in CSS,
      // but the poster-cta section should use the custom CTA not the default one
      const posterSection = html.match(/<div class="poster-overlay"[^>]*>([\s\S]*?)<div class="tap-hint">/)?.[1] || '';
      expect(posterSection).toContain('Custom CTA');
    });
  });

  describe('XSS prevention (HTML escaping)', () => {
    it('escapes special characters in clickThroughUrl', () => {
      const config = baseConfig({ clickThroughUrl: 'https://evil.com/"><script>alert(1)</script>' });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes special characters in video URL', () => {
      const html = generateCreativeHtml(baseConfig(), 'https://cdn.com/vid?a=1&b=2', 'p.jpg');
      expect(html).toContain('https://cdn.com/vid?a=1&amp;b=2');
    });

    it('escapes special characters in poster URL', () => {
      const html = generateCreativeHtml(baseConfig(), 'v.mp4', 'https://cdn.com/p?a=1&b=2');
      expect(html).toContain('https://cdn.com/p?a=1&amp;b=2');
    });

    it('escapes CTA text in timeline events', () => {
      const event: TimelineEvent = {
        id: 'xss',
        frameIndex: 0,
        timestamp: 0,
        duration: 3,
        cta: { text: '<img src=x onerror=alert(1)>', position: { x: 50, y: 80 }, style: 'primary', size: 'medium', visible: true, action: 'link' },
        overlay: { type: 'none', text: '', position: 'top-right', visible: false },
        animation: 'fade-in',
        pauseVideo: false,
      };
      const config = baseConfig({ timeline: [event], posterFrameIndex: 0 });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img src=x');
    });
  });

  describe('timeline CTA buttons', () => {
    it('renders timeline CTAs with data-show-at and data-hide-at attributes', () => {
      const event: TimelineEvent = {
        id: 'tl1',
        frameIndex: 5,  // non-poster
        timestamp: 2.5,
        duration: 3.0,
        cta: { text: 'Buy Now', position: { x: 60, y: 70 }, style: 'floating', size: 'large', visible: true, action: 'link' },
        overlay: { type: 'none', text: '', position: 'top-right', visible: false },
        animation: 'slide-up',
        pauseVideo: false,
      };
      const config = baseConfig({ timeline: [event], posterFrameIndex: 0 });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).toContain('data-show-at="2.5"');
      expect(html).toContain('data-hide-at="5.5"');
      expect(html).toContain('data-anim="slide-up"');
      expect(html).toContain('Buy Now');
    });

    it('renders pause attribute when pauseVideo is true', () => {
      const event: TimelineEvent = {
        id: 'tl2',
        frameIndex: 3,
        timestamp: 5.0,
        duration: 2.0,
        cta: { text: 'Tap!', position: { x: 50, y: 50 }, style: 'pulse', size: 'medium', visible: true, action: 'link' },
        overlay: { type: 'none', text: '', position: 'top-right', visible: false },
        animation: 'bounce',
        pauseVideo: true,
      };
      const config = baseConfig({ timeline: [event], posterFrameIndex: 0 });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).toContain('data-pause="true"');
    });

    it('renders non-link action buttons as <button> with data-action', () => {
      const event: TimelineEvent = {
        id: 'tl3',
        frameIndex: 2,
        timestamp: 1.0,
        duration: 2.0,
        cta: { text: 'Replay', position: { x: 50, y: 80 }, style: 'primary', size: 'medium', visible: true, action: 'replay' },
        overlay: { type: 'none', text: '', position: 'top-right', visible: false },
        animation: 'fade-in',
        pauseVideo: false,
      };
      const config = baseConfig({ timeline: [event], posterFrameIndex: 0 });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).toContain('<button');
      expect(html).toContain('data-action="replay"');
      expect(html).toContain('Replay');
    });

    it('renders overlay elements for timeline events', () => {
      const event: TimelineEvent = {
        id: 'tl4',
        frameIndex: 4,
        timestamp: 3.0,
        duration: 2.0,
        cta: { text: 'Go', position: { x: 50, y: 80 }, style: 'primary', size: 'medium', visible: false, action: 'link' },
        overlay: { type: 'badge', text: 'NEW', position: 'top-left', visible: true },
        animation: 'fade-in',
        pauseVideo: false,
      };
      const config = baseConfig({ timeline: [event], posterFrameIndex: 0 });
      const html = generateCreativeHtml(config, 'v.mp4', 'p.jpg');
      expect(html).toContain('class="overlay-el badge pos-top-left"');
      expect(html).toContain('NEW');
    });
  });
});

// ---------------------------------------------------------------------------
// vision.ts
// ---------------------------------------------------------------------------

describe('vision.ts', () => {
  let env: Env;

  beforeEach(() => {
    env = createMockEnv();
    // By default, make the model agreement check pass
    kv(env).get.mockImplementation(async (key: string) => {
      if (key === 'meta:model_agreed') return 'true';
      return null;
    });
  });

  describe('analyzeFrame', () => {
    it('returns DEFAULT_ANALYSIS when AI returns short garbage (no JSON, under 10 chars)', async () => {
      // Text <= 10 chars won't trigger buildFromDescription fallback
      ai(env).run.mockResolvedValue({ response: 'bad' });

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));

      expect(result.analysis.sceneType).toBe('gameplay');
      expect(result.analysis.description).toBe('Frame could not be analyzed');
      expect(result.analysis.isAction).toBe(false);
      expect(result.analysis.actionType).toBe('none');
      expect(result.neurons).toBe(66);
    });

    it('falls back to buildFromDescription when AI returns long non-JSON garbage', async () => {
      // Text > 10 chars on second attempt triggers buildFromDescription
      ai(env).run.mockResolvedValue({ response: 'totally garbled nonsense no json here' });

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));

      // buildFromDescription produces a gameplay scene with importance 4 for unrecognized text
      expect(result.analysis.sceneType).toBe('gameplay');
      expect(result.analysis.isAction).toBe(false);
      expect(result.analysis.importance).toBe(4);
      expect(result.neurons).toBe(66);
    });

    it('returns DEFAULT_ANALYSIS when AI returns empty string', async () => {
      ai(env).run.mockResolvedValue({ response: '' });

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));

      expect(result.analysis.description).toBe('Frame could not be analyzed');
      expect(result.analysis.isAction).toBe(false);
    });

    it('parses valid JSON response from AI correctly', async () => {
      const validResponse = JSON.stringify({
        description: 'Character performing a heavy slash with visible sparks',
        sceneType: 'action',
        mood: 'intense',
        importance: 9,
        isAction: true,
        actionType: 'attack',
        actionLabel: 'Heavy Strike!',
        cta: { text: 'Fight Now', position: { x: 50, y: 80 }, style: 'pulse', size: 'large' },
        overlay: { type: 'none', text: '', position: 'top-right' },
        animationSuggestion: 'shake',
      });

      ai(env).run.mockResolvedValue({ response: validResponse });

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));

      expect(result.analysis.isAction).toBe(true);
      expect(result.analysis.actionType).toBe('attack');
      expect(result.analysis.sceneType).toBe('action');
      expect(result.analysis.importance).toBe(9);
      expect(result.analysis.description).toContain('heavy slash');
      expect(result.rawResponse).toBeTruthy();
    });

    it('parses JSON wrapped in markdown code fences', async () => {
      const wrapped = '```json\n' + JSON.stringify({
        description: 'Epic jump',
        sceneType: 'action',
        mood: 'intense',
        importance: 8,
        isAction: true,
        actionType: 'jump',
        actionLabel: 'Epic Jump!',
        cta: { text: 'Play', position: { x: 50, y: 80 }, style: 'bounce', size: 'large' },
        overlay: { type: 'none', text: '', position: 'top-right' },
        animationSuggestion: 'slide-up',
      }) + '\n```';

      ai(env).run.mockResolvedValue({ response: wrapped });

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));
      expect(result.analysis.isAction).toBe(true);
      expect(result.analysis.actionType).toBe('jump');
    });

    it('throws on 429 rate limit errors', async () => {
      ai(env).run.mockRejectedValue(new Error('429 Too Many Requests'));

      await expect(analyzeFrame(env, new Uint8Array([1, 2, 3]))).rejects.toThrow('429');
    });

    it('throws on rate limit error messages', async () => {
      ai(env).run.mockRejectedValue(new Error('rate limit exceeded'));

      await expect(analyzeFrame(env, new Uint8Array([1, 2, 3]))).rejects.toThrow('rate limit');
    });

    it('throws on "too many requests" error messages', async () => {
      ai(env).run.mockRejectedValue(new Error('too many requests'));

      await expect(analyzeFrame(env, new Uint8Array([1, 2, 3]))).rejects.toThrow('too many');
    });

    it('forces isAction=false when actionType is "none"', async () => {
      const response = JSON.stringify({
        description: 'Character standing',
        sceneType: 'gameplay',
        mood: 'calm',
        importance: 5,
        isAction: true,   // model wrongly says true
        actionType: 'none', // but actionType is none
        actionLabel: '',
        cta: { text: 'Play', position: { x: 50, y: 80 }, style: 'primary', size: 'medium' },
        overlay: { type: 'none', text: '', position: 'top-right' },
        animationSuggestion: 'fade-in',
      });

      ai(env).run.mockResolvedValue({ response });

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));
      expect(result.analysis.isAction).toBe(false);
    });

    it('forces isAction=false when importance < 7', async () => {
      const response = JSON.stringify({
        description: 'Character moving around',
        sceneType: 'gameplay',
        mood: 'exciting',
        importance: 6,     // below 7
        isAction: true,    // model wrongly says true
        actionType: 'attack',
        actionLabel: 'Strike!',
        cta: { text: 'Play', position: { x: 50, y: 80 }, style: 'pulse', size: 'large' },
        overlay: { type: 'none', text: '', position: 'top-right' },
        animationSuggestion: 'shake',
      });

      ai(env).run.mockResolvedValue({ response });

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));
      expect(result.analysis.isAction).toBe(false);
    });

    it('forces isAction=false when description says running', async () => {
      const response = JSON.stringify({
        description: 'Character running forward with sword drawn',
        sceneType: 'action',
        mood: 'intense',
        importance: 8,
        isAction: true,
        actionType: 'attack',
        actionLabel: 'Strike!',
        cta: { text: 'Fight', position: { x: 50, y: 80 }, style: 'pulse', size: 'large' },
        overlay: { type: 'none', text: '', position: 'top-right' },
        animationSuggestion: 'shake',
      });

      ai(env).run.mockResolvedValue({ response });

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));
      expect(result.analysis.isAction).toBe(false);
      expect(result.analysis.actionType).toBe('none');
    });

    it('reclassifies attack to jump when description mentions mid-air', async () => {
      const response = JSON.stringify({
        description: 'Character mid-air with sword raised above',
        sceneType: 'action',
        mood: 'intense',
        importance: 9,
        isAction: true,
        actionType: 'attack',
        actionLabel: 'Strike!',
        cta: { text: 'Play', position: { x: 50, y: 80 }, style: 'pulse', size: 'large' },
        overlay: { type: 'none', text: '', position: 'top-right' },
        animationSuggestion: 'shake',
      });

      ai(env).run.mockResolvedValue({ response });

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));
      expect(result.analysis.isAction).toBe(true);
      expect(result.analysis.actionType).toBe('jump');
      expect(result.analysis.actionLabel).toBe('Epic Jump!');
    });

    it('reclassifies attack to dodge when description mentions diving', async () => {
      // The regex uses \b(roll|tumbl|dodg|diving|evasive|low to ground)\b
      // "diving" is a complete word so it matches \bdiving\b
      const response = JSON.stringify({
        description: 'Character diving to the side to avoid incoming attack',
        sceneType: 'action',
        mood: 'intense',
        importance: 8,
        isAction: true,
        actionType: 'attack',
        actionLabel: 'Strike!',
        cta: { text: 'Play', position: { x: 50, y: 80 }, style: 'pulse', size: 'large' },
        overlay: { type: 'none', text: '', position: 'top-right' },
        animationSuggestion: 'shake',
      });

      ai(env).run.mockResolvedValue({ response });

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));
      expect(result.analysis.isAction).toBe(true);
      expect(result.analysis.actionType).toBe('dodge');
      expect(result.analysis.actionLabel).toBe('Dodge Roll!');
    });

    it('uses refinement prompt and returns lower neuron count for refinement mode', async () => {
      const response = JSON.stringify({
        isAction: false,
        actionType: 'none',
        actionLabel: '',
        importance: 5,
      });

      ai(env).run.mockResolvedValue({ response });

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]), true);
      expect(result.neurons).toBe(33);
      expect(result.analysis.isAction).toBe(false);
    });

    it('handles AI returning a plain string (non-object response) too short for buildFromDescription', async () => {
      // Short plain string (<=10 chars) on both attempts -> DEFAULT_ANALYSIS
      ai(env).run.mockResolvedValue('xyz');

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));
      expect(result.analysis.description).toBe('Frame could not be analyzed');
    });

    it('handles AI returning a plain string via buildFromDescription when long enough', async () => {
      // Long plain string (>10 chars) on second attempt -> buildFromDescription fallback
      ai(env).run.mockResolvedValue('some plain text with no json at all but long enough');

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));
      // buildFromDescription uses the text as description (truncated to 120 chars)
      expect(result.analysis.sceneType).toBe('gameplay');
      expect(result.analysis.isAction).toBe(false);
      expect(result.analysis.importance).toBe(4);
    });

    it('falls back to buildFromDescription on second attempt with long non-JSON text', async () => {
      // First attempt: AI returns parseable but not JSON
      // Second attempt: AI returns description with action keywords
      let callCount = 0;
      ai(env).run.mockImplementation(async () => {
        callCount++;
        if (callCount <= 1) {
          return { response: 'x' }; // too short, not parseable
        }
        // Second call: long enough text with impact keywords
        return { response: 'The character is performing an impact strike with visible sparks and flash effects on the enemy, causing massive damage to the opponent' };
      });

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));
      expect(result.analysis.isAction).toBe(true);
      expect(result.analysis.actionType).toBe('attack');
    });

    it('retries once on non-rate-limit errors, then returns default', async () => {
      ai(env).run
        .mockRejectedValueOnce(new Error('Model temporarily unavailable'))
        .mockRejectedValueOnce(new Error('Model temporarily unavailable'));

      const result = await analyzeFrame(env, new Uint8Array([1, 2, 3]));
      expect(result.analysis.description).toBe('Frame could not be analyzed');
      expect(ai(env).run).toHaveBeenCalledTimes(2);
    });
  });

  describe('analyzeWithCvContext', () => {
    function baseCvCandidate(overrides: Partial<CvCandidate> = {}): CvCandidate {
      return {
        index: 5,
        timestamp: 2.5,
        motion_score: 0.8,
        near_scene_boundary: false,
        scene_type: 'mid-scene',
        jpeg_base64: btoa('fake-image-data'),
        cv_confidence: 0.75,
        ...overrides,
      };
    }

    it('returns default analysis when AI returns short garbage', async () => {
      // Short text (<=10 chars) won't trigger buildFromDescription
      ai(env).run.mockResolvedValue({ response: 'bad' });

      const result = await analyzeWithCvContext(env, baseCvCandidate());

      expect(result.sceneType).toBe('gameplay');
      expect(result.description).toBe('Frame could not be analyzed');
      expect(result.isAction).toBe(false);
    });

    it('falls back to buildFromDescription when AI returns long garbage', async () => {
      ai(env).run.mockResolvedValue({ response: 'no json here at all but this is long enough text' });

      const result = await analyzeWithCvContext(env, baseCvCandidate());

      // buildFromDescription classifies as gameplay with importance 4
      expect(result.sceneType).toBe('gameplay');
      expect(result.isAction).toBe(false);
      expect(result.importance).toBe(4);
    });

    it('parses valid JSON response from AI', async () => {
      const validResponse = JSON.stringify({
        description: 'Character delivering a heavy slash with spark impact',
        sceneType: 'action',
        mood: 'intense',
        importance: 9,
        isAction: true,
        actionType: 'attack',
        actionLabel: 'Heavy Strike!',
        cta: { text: 'Play', position: { x: 50, y: 80 }, style: 'pulse', size: 'large' },
        overlay: { type: 'none', text: '', position: 'top-right' },
        animationSuggestion: 'shake',
      });

      ai(env).run.mockResolvedValue({ response: validResponse });

      const result = await analyzeWithCvContext(env, baseCvCandidate());
      expect(result.isAction).toBe(true);
      expect(result.actionType).toBe('attack');
    });

    it('throws on 429 rate limit errors', async () => {
      ai(env).run.mockRejectedValue(new Error('429 Too Many Requests'));

      await expect(analyzeWithCvContext(env, baseCvCandidate())).rejects.toThrow('429');
    });

    it('includes CV context (motion level, confidence) in the prompt sent to AI', async () => {
      const candidate = baseCvCandidate({ motion_score: 0.9, cv_confidence: 0.85 });
      ai(env).run.mockResolvedValue({ response: JSON.stringify({
        description: 'test', sceneType: 'gameplay', mood: 'calm', importance: 5,
        isAction: false, actionType: 'none', actionLabel: '',
        cta: { text: 'Play', position: { x: 50, y: 80 }, style: 'primary', size: 'medium' },
      }) });

      await analyzeWithCvContext(env, candidate);

      // Verify the prompt passed to AI.run includes CV context
      const callArgs = ai(env).run.mock.calls[0];
      const promptArg = callArgs[1].prompt;
      expect(promptArg).toContain('Motion level: HIGH');
      expect(promptArg).toContain('0.85');
      expect(promptArg).toContain('COMPUTER VISION PRE-ANALYSIS');
    });

    it('falls back to buildFromDescription when JSON parse fails on retry', async () => {
      let callCount = 0;
      ai(env).run.mockImplementation(async () => {
        callCount++;
        if (callCount <= 1) {
          return { response: '' }; // empty, parse fails
        }
        // Second attempt: long description with airborne keywords
        return { response: 'The character is mid-air and airborne, leaping high over the battlefield with great speed and power' };
      });

      const result = await analyzeWithCvContext(env, baseCvCandidate());
      expect(result.isAction).toBe(true);
      expect(result.actionType).toBe('jump');
    });

    it('uses LOW motion level for low motion_score', async () => {
      const candidate = baseCvCandidate({ motion_score: 0.1 });
      ai(env).run.mockResolvedValue({ response: JSON.stringify({
        description: 'standing', sceneType: 'gameplay', mood: 'calm', importance: 3,
        isAction: false, actionType: 'none', actionLabel: '',
        cta: { text: 'Play', position: { x: 50, y: 80 }, style: 'primary', size: 'medium' },
      }) });

      await analyzeWithCvContext(env, candidate);

      const promptArg = ai(env).run.mock.calls[0][1].prompt;
      expect(promptArg).toContain('Motion level: LOW');
    });

    it('includes scene boundary info in prompt when near_scene_boundary is true', async () => {
      const candidate = baseCvCandidate({ near_scene_boundary: true, scene_type: 'hard_cut' });
      ai(env).run.mockResolvedValue({ response: JSON.stringify({
        description: 'scene', sceneType: 'gameplay', mood: 'calm', importance: 3,
        isAction: false, actionType: 'none', actionLabel: '',
        cta: { text: 'Play', position: { x: 50, y: 80 }, style: 'primary', size: 'medium' },
      }) });

      await analyzeWithCvContext(env, candidate);

      const promptArg = ai(env).run.mock.calls[0][1].prompt;
      expect(promptArg).toContain('near a scene cut');
      expect(promptArg).toContain('hard_cut');
    });
  });
});
