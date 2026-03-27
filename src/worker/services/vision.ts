import { Env, FrameAnalysis, CvCandidate } from '../types';

// Enhanced prompt used when CV metadata is available (v2.0 path via Container)
// The model gets optical flow context so it can confirm/reject a CV hypothesis
function buildEnhancedPrompt(cv: CvCandidate): string {
  const motionLevel = cv.motion_score > 0.6 ? 'HIGH' : cv.motion_score > 0.3 ? 'MEDIUM' : 'LOW';
  const sceneNote = cv.near_scene_boundary
    ? `near a scene cut (${cv.scene_type})`
    : 'mid-scene (no recent cut)';
  return `You are analyzing a video game screenshot.

COMPUTER VISION PRE-ANALYSIS (from optical flow):
- Motion level: ${motionLevel} (score: ${cv.motion_score.toFixed(2)})
- Scene position: ${sceneNote}
- CV confidence for action moment: ${cv.cv_confidence.toFixed(2)} / 1.0

The CV system detected ${motionLevel} localized motion, suggesting this frame is ${cv.cv_confidence > 0.5 ? 'LIKELY' : 'UNLIKELY'} an action moment.

Your task: CONFIRM or REJECT this assessment by analyzing what you see.

FIRST describe these 3 things:
1. CHARACTER BODY: Standing upright? Crouching? Airborne? Rolling on ground? Running?
2. WEAPON/EFFECTS: Visible impact flash, slash trail, or explosion RIGHT NOW? Or weapon just held?
3. MOVEMENT: Clear motion blur or action pose? Or relatively still?

THEN classify using ONLY these rules:
- "attack" = WEAPON IS ACTIVELY HITTING. You MUST see impact sparks/flash/slash trail.
- "dodge" = Body LOW to ground, rolling sideways, or tumbling.
- "jump" = Feet CLEARLY OFF ground. Airborne.
- "shoot" = Projectile or arrow visibly flying.
- "spell" = Glowing magic effects from character's hands/body.
- "none" = Standing, running, walking, idle, menu. Running with weapon = NOT an action.

CRITICAL: Running or walking is NEVER an action even with high CV motion score (camera can pan).
You need IMPACT EFFECTS or CLEAR COMBAT ANIMATION to mark as action.

Return ONLY this JSON:
{"description":"what character body is doing","sceneType":"action","mood":"intense","importance":8,"isAction":true,"actionType":"attack","actionLabel":"Heavy Strike!","cta":{"text":"Play Now","position":{"x":50,"y":80},"style":"pulse","size":"large"},"overlay":{"type":"none","text":"","position":"top-right"},"animationSuggestion":"shake"}

importance: 8-10 ONLY if isAction=true with clear combat. 4-6 for running/standing. 1-3 for menus.
Valid sceneType: gameplay, action, cutscene, title, menu, landscape, character
Valid mood: intense, calm, dramatic, exciting, mysterious, epic
Valid cta.style: primary, secondary, floating, pulse, glow, slide-in, bounce, glass`;
}

// Chain-of-thought prompt — model must describe BODY POSITION first, then classify
// This is critical because the 11B model defaults to "attack" for any game character with a weapon
const ANALYSIS_PROMPT = `You are analyzing a video game screenshot. Look VERY carefully at the character's body.

FIRST describe these 3 things (think step by step):
1. CHARACTER BODY: Is the character standing upright? Crouching? Airborne with feet off ground? Lying/rolling on ground? Leaning forward running?
2. WEAPON/EFFECTS: Is there a visible impact flash, slash trail, or explosion RIGHT NOW? Or is the weapon just being held normally?
3. MOVEMENT: Is the character clearly in MOTION (blur, action pose) or relatively STILL?

THEN classify using ONLY these rules:
- "attack" = WEAPON IS ACTIVELY HITTING something. You MUST see impact sparks/flash/slash trail. Just holding a weapon while running is NOT attack.
- "dodge" = Character body is LOW to the ground, rolling sideways, or tumbling. Evasive movement.
- "jump" = Character feet are CLEARLY OFF the ground. Airborne. Leaping.
- "shoot" = Projectile or arrow visibly flying away from character.
- "spell" = Glowing magic effects emanating FROM the character's hands/body.
- "none" = Character is standing, running, walking, idle, or in a menu. Running with a weapon is NOT an action. Just moving forward is NOT an action.

CRITICAL: Running or walking is NEVER an action. A character moving forward = "none". You need to see IMPACT EFFECTS or CLEAR COMBAT ANIMATION to mark as action.

Return ONLY this JSON:
{"description":"what character body is doing","sceneType":"action","mood":"intense","importance":8,"isAction":true,"actionType":"attack","actionLabel":"Heavy Strike!","cta":{"text":"Play Now","position":{"x":50,"y":80},"style":"pulse","size":"large"},"overlay":{"type":"none","text":"","position":"top-right"},"animationSuggestion":"shake"}

importance: 8-10 ONLY if isAction=true with clear combat. 4-6 for running/standing. 1-3 for menus.
Valid sceneType: gameplay, action, cutscene, title, menu, landscape, character
Valid mood: intense, calm, dramatic, exciting, mysterious, epic
Valid cta.style: primary, secondary, floating, pulse, glow, slide-in, bounce, glass`;

// Refinement: is action happening RIGHT NOW in this frame?
const REFINEMENT_PROMPT = `Look at the game character's body carefully.
- Are they swinging a weapon with visible impact/slash effect? → attack
- Are they rolling/tumbling on the ground? → dodge
- Are their feet clearly off the ground, airborne? → jump
- Are they just standing, running, or walking? → none (NOT an action)

Running with a weapon is NOT an action. You need impact effects or combat animation.

Return JSON: {"isAction":false,"actionType":"none","actionLabel":"","importance":5}`;

type PartialAnalysis = Omit<FrameAnalysis, 'frameIndex' | 'timestamp' | 'thumbnailKey'>;

const DEFAULT_ANALYSIS: PartialAnalysis = {
  sceneType: 'gameplay',
  description: 'Frame could not be analyzed',
  mood: 'calm',
  importance: 5,
  isAction: false,
  actionType: 'none',
  actionLabel: '',
  cta: {
    text: 'Play Now',
    position: { x: 50, y: 80 },
    style: 'primary',
    size: 'medium',
    visible: true,
    action: 'link',
  },
  overlay: { type: 'none', text: '', position: 'top-right', visible: false },
  animationSuggestion: 'fade-in',
};

function parseAnalysisResponse(raw: string): PartialAnalysis | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  // Extract JSON from chain-of-thought text
  const jsonMatch = cleaned.match(/\{[^{}]*"(?:sceneType|isAction)"[^{}]*\}/s) || cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];

  try {
    const parsed = JSON.parse(cleaned);

    // CTA defaults
    if (parsed.cta?.position) {
      parsed.cta.position.x = Math.max(5, Math.min(95, parsed.cta.position.x || 50));
      parsed.cta.position.y = Math.max(5, Math.min(95, parsed.cta.position.y || 80));
    } else if (parsed.cta) {
      parsed.cta.position = { x: 50, y: 80 };
    }
    if (parsed.cta) {
      parsed.cta.visible = true;
      parsed.cta.size = parsed.cta.size || 'medium';
      parsed.cta.action = parsed.cta.action || 'link';
    } else {
      parsed.cta = { ...DEFAULT_ANALYSIS.cta };
    }
    parsed.overlay = parsed.overlay || { type: 'none', text: '', position: 'top-right', visible: false };
    parsed.overlay.visible = parsed.overlay.type !== 'none';
    parsed.animationSuggestion = parsed.animationSuggestion || 'fade-in';
    parsed.importance = parsed.importance || 5;
    parsed.isAction = !!parsed.isAction;
    parsed.actionType = parsed.actionType || 'none';
    parsed.actionLabel = parsed.actionLabel || '';
    parsed.sceneType = parsed.sceneType || (parsed.isAction ? 'action' : 'gameplay');

    // STRICT validation: if actionType is "none", force isAction=false
    if (parsed.actionType === 'none') parsed.isAction = false;
    // If importance < 7 and model says isAction, likely a false positive
    if (parsed.isAction && parsed.importance < 7) parsed.isAction = false;

    // Cross-check description vs actionType to fix model confusion
    const desc = (parsed.description || '').toLowerCase();
    if (parsed.isAction) {
      // Fix: model says "attack" but description says jumping/airborne
      if (/\b(jump|mid-air|airborne|leap|feet off|flying)\b/.test(desc) && parsed.actionType === 'attack') {
        parsed.actionType = 'jump';
        parsed.actionLabel = 'Epic Jump!';
      }
      // Fix: model says "attack" but description says rolling/dodging
      if (/\b(roll|tumbl|dodg|diving|evasive|low to ground)\b/.test(desc) && parsed.actionType === 'attack') {
        parsed.actionType = 'dodge';
        parsed.actionLabel = 'Dodge Roll!';
      }
      // Fix: model says "jump" but description says swinging/hitting
      if (/\b(swing|slash|hit|strike|impact|weapon.*contact)\b/.test(desc) && parsed.actionType === 'jump') {
        parsed.actionType = 'attack';
        parsed.actionLabel = 'Heavy Strike!';
      }
      // Fix: description says running/walking — NOT an action
      if (/\b(running|walking|moving forward|jogging|sprinting)\b/.test(desc) && !/\b(while|slash|swing|hit)\b/.test(desc)) {
        parsed.isAction = false;
        parsed.actionType = 'none';
        parsed.actionLabel = '';
        parsed.importance = Math.min(parsed.importance, 5);
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

function parseRefinementResponse(raw: string): { isAction: boolean; actionType: string; actionLabel: string; importance: number } | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];

  try {
    const parsed = JSON.parse(cleaned);
    const isAction = !!parsed.isAction && parsed.actionType !== 'none' && (parsed.importance || 5) >= 7;
    return {
      isAction,
      actionType: isAction ? (parsed.actionType || 'none') : 'none',
      actionLabel: isAction ? (parsed.actionLabel || '') : '',
      importance: parsed.importance || 5,
    };
  } catch {
    return null;
  }
}

function buildFromDescription(text: string): PartialAnalysis {
  const lower = text.toLowerCase();
  let sceneType: any = 'gameplay';
  let mood: any = 'exciting';
  let ctaText = 'Play Now';
  let style: any = 'pulse';
  let importance = 5;
  let isAction = false;
  let actionType = 'none';
  let actionLabel = '';

  // Only mark as action if there are CLEAR combat visual cues
  const hasImpact = /\b(impact|flash|sparks?|explosion|slash trail|hit|striking|swinging weapon)\b/.test(lower);
  const isAirborne = /\b(mid-air|airborne|jumping|leaping|feet off)\b/.test(lower);
  const isRolling = /\b(rolling|tumbling|dodging|diving|evasive)\b/.test(lower);
  const isRunning = /\b(running|walking|moving|standing|idle|jogging)\b/.test(lower);

  if (hasImpact && !isRunning) {
    isAction = true; sceneType = 'action'; actionType = 'attack'; actionLabel = 'Strike!';
    ctaText = 'Fight Now'; importance = 9; mood = 'intense'; style = 'pulse';
  } else if (isAirborne && !isRunning) {
    isAction = true; sceneType = 'action'; actionType = 'jump'; actionLabel = 'Epic Jump!';
    ctaText = 'Play Now'; importance = 8; mood = 'intense'; style = 'bounce';
  } else if (isRolling) {
    isAction = true; sceneType = 'action'; actionType = 'dodge'; actionLabel = 'Dodge Roll!';
    ctaText = 'Play Now'; importance = 8; mood = 'intense'; style = 'slide-in';
  } else if (lower.includes('menu') || lower.includes('title') || lower.includes('logo')) {
    sceneType = lower.includes('menu') ? 'menu' : 'title';
    mood = 'calm'; ctaText = 'Start'; style = 'primary'; importance = 3;
  } else if (lower.includes('landscape') || lower.includes('scenery') || lower.includes('snow')) {
    sceneType = 'landscape'; mood = 'epic'; ctaText = 'Explore'; style = 'glass'; importance = 5;
  } else {
    // Default: not an action (running, walking, etc.)
    sceneType = 'gameplay'; importance = 4;
  }

  const desc = text.length > 120 ? text.slice(0, 120) + '...' : text;

  return {
    sceneType,
    description: desc || 'Scene from video',
    mood,
    importance,
    isAction,
    actionType,
    actionLabel,
    cta: { text: ctaText, position: { x: 50, y: 80 }, style, size: 'large', visible: true, action: 'link' },
    overlay: { type: 'none', text: '', position: 'top-right', visible: false },
    animationSuggestion: isAction ? (actionType === 'attack' ? 'shake' : actionType === 'jump' ? 'slide-up' : 'bounce') : 'fade-in',
  };
}

async function ensureModelAgreed(env: Env): Promise<void> {
  const agreed = await env.KV.get('meta:model_agreed');
  if (agreed) return;
  try {
    await env.AI.run(
      '@cf/meta/llama-3.2-11b-vision-instruct' as BaseAiTextGenerationModels,
      { prompt: 'agree' } as any,
    );
  } catch { /* ok */ }
  await env.KV.put('meta:model_agreed', 'true');
}

export async function analyzeFrame(
  env: Env,
  imageBytes: Uint8Array,
  isRefinement = false,
): Promise<{ analysis: PartialAnalysis; neurons: number; rawResponse?: string }> {
  await ensureModelAgreed(env);
  const imageArray = [...imageBytes];
  const estimatedNeurons = isRefinement ? 33 : 66;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const prompt = isRefinement
        ? REFINEMENT_PROMPT
        : (attempt === 0
          ? ANALYSIS_PROMPT
          : 'Describe the character body position (standing/crouching/airborne/rolling). Is there weapon impact effect visible? Return JSON: {"description":"...","sceneType":"gameplay","mood":"calm","importance":5,"isAction":false,"actionType":"none","actionLabel":"","cta":{"text":"Play Now","position":{"x":50,"y":80},"style":"primary","size":"large"},"overlay":{"type":"none","text":"","position":"top-right"},"animationSuggestion":"fade-in"}');

      const result = await env.AI.run(
        '@cf/meta/llama-3.2-11b-vision-instruct' as BaseAiTextGenerationModels,
        {
          prompt,
          image: imageArray,
          max_tokens: isRefinement ? 200 : 800,
        } as any,
      );

      const text = typeof result === 'string'
        ? result
        : (result as { response?: string }).response || '';

      if (isRefinement) {
        const refined = parseRefinementResponse(text);
        if (refined) {
          return {
            analysis: {
              ...DEFAULT_ANALYSIS,
              isAction: refined.isAction,
              actionType: refined.actionType,
              actionLabel: refined.actionLabel,
              importance: refined.importance,
              sceneType: refined.isAction ? 'action' : 'gameplay',
            },
            neurons: estimatedNeurons,
            rawResponse: text.slice(0, 300),
          };
        }
      } else {
        const parsed = parseAnalysisResponse(text);
        if (parsed) {
          return { analysis: parsed, neurons: estimatedNeurons, rawResponse: text.slice(0, 300) };
        }

        if (text.length > 10 && attempt === 1) {
          const fallback = buildFromDescription(text);
          return { analysis: fallback, neurons: estimatedNeurons, rawResponse: text.slice(0, 300) };
        }
      }
    } catch (err) {
      const msg = String(err);
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many')) {
        throw err; // propagate so analyze route can return 429 to client
      }
      console.error(`[vision] Attempt ${attempt + 1} failed:`, err);
      if (attempt === 1) break;
    }
  }

  return { analysis: { ...DEFAULT_ANALYSIS }, neurons: estimatedNeurons };
}

/**
 * v2.0 entry point — analyze a CV candidate frame with optical flow context injected.
 * Used by the /api/process route after the Container returns candidates.
 *
 * The enhanced prompt tells the model the CV confidence score and motion level so it can
 * confirm or reject the CV system's hypothesis rather than classifying from scratch.
 */
export async function analyzeWithCvContext(
  env: Env,
  candidate: CvCandidate,
): Promise<PartialAnalysis> {
  await ensureModelAgreed(env);

  const imageBytes = Uint8Array.from(atob(candidate.jpeg_base64), (ch) => ch.charCodeAt(0));
  const imageArray = [...imageBytes];
  const prompt = buildEnhancedPrompt(candidate);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const usePrompt = attempt === 0
        ? prompt
        : 'Describe the character body position and any visible weapon impact. Return JSON: {"description":"...","sceneType":"gameplay","mood":"calm","importance":5,"isAction":false,"actionType":"none","actionLabel":"","cta":{"text":"Play Now","position":{"x":50,"y":80},"style":"primary","size":"large"},"overlay":{"type":"none","text":"","position":"top-right"},"animationSuggestion":"fade-in"}';

      const result = await env.AI.run(
        '@cf/meta/llama-3.2-11b-vision-instruct' as BaseAiTextGenerationModels,
        { prompt: usePrompt, image: imageArray, max_tokens: 800 } as any,
      );

      const text = typeof result === 'string'
        ? result
        : (result as { response?: string }).response || '';

      const parsed = parseAnalysisResponse(text);
      if (parsed) return parsed;

      if (text.length > 10 && attempt === 1) {
        return buildFromDescription(text);
      }
    } catch (err) {
      const msg = String(err);
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many')) {
        throw err;
      }
      console.error(`[vision] analyzeWithCvContext attempt ${attempt + 1} failed:`, err);
      if (attempt === 1) break;
    }
  }

  return { ...DEFAULT_ANALYSIS };
}
