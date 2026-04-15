import type { CreativeConfig, AnimationType, ButtonStyle } from './types';

export interface GameTemplate {
  id: string;
  name: string;
  genre: string;
  icon: string;
  events: Array<{
    timestamp: number;
    duration: number;
    ctaText: string;
    ctaStyle: ButtonStyle;
    ctaSize: 'small' | 'medium' | 'large';
    ctaX: number;
    ctaY: number;
    animation: AnimationType;
  }>;
}

export const TEMPLATES: GameTemplate[] = [
  {
    id: 'racing', name: 'Racing', genre: 'Racing', icon: '🏎️',
    events: [
      { timestamp: 2.0, duration: 0.6, ctaText: 'Race Now!', ctaStyle: 'glow', ctaSize: 'large', ctaX: 50, ctaY: 82, animation: 'zoom-in' },
      { timestamp: 8.0, duration: 0.6, ctaText: 'Play Free', ctaStyle: 'pulse', ctaSize: 'medium', ctaX: 50, ctaY: 85, animation: 'bounce' },
    ],
  },
  {
    id: 'rpg', name: 'RPG', genre: 'RPG', icon: '⚔️',
    events: [
      { timestamp: 1.5, duration: 0.7, ctaText: 'Start Quest', ctaStyle: 'glass', ctaSize: 'large', ctaX: 50, ctaY: 80, animation: 'fade-in' },
      { timestamp: 6.0, duration: 0.6, ctaText: 'Level Up!', ctaStyle: 'glow', ctaSize: 'medium', ctaX: 50, ctaY: 85, animation: 'slide-up' },
      { timestamp: 12.0, duration: 0.6, ctaText: 'Download', ctaStyle: 'primary', ctaSize: 'large', ctaX: 50, ctaY: 83, animation: 'pulse' },
    ],
  },
  {
    id: 'puzzle', name: 'Puzzle', genre: 'Puzzle', icon: '🧩',
    events: [
      { timestamp: 3.0, duration: 0.6, ctaText: 'Solve It!', ctaStyle: 'floating', ctaSize: 'large', ctaX: 50, ctaY: 82, animation: 'bounce' },
      { timestamp: 10.0, duration: 0.6, ctaText: 'Play Now', ctaStyle: 'primary', ctaSize: 'medium', ctaX: 50, ctaY: 85, animation: 'zoom-in' },
    ],
  },
  {
    id: 'shooter', name: 'Shooter', genre: 'Shooter', icon: '🎯',
    events: [
      { timestamp: 1.0, duration: 0.5, ctaText: 'Fire!', ctaStyle: 'pulse', ctaSize: 'large', ctaX: 50, ctaY: 80, animation: 'zoom-in' },
      { timestamp: 5.0, duration: 0.6, ctaText: 'Join Battle', ctaStyle: 'glow', ctaSize: 'large', ctaX: 50, ctaY: 83, animation: 'shake' },
      { timestamp: 11.0, duration: 0.6, ctaText: 'Install Free', ctaStyle: 'primary', ctaSize: 'medium', ctaX: 50, ctaY: 85, animation: 'slide-up' },
    ],
  },
  {
    id: 'battle-royale', name: 'Battle Royale', genre: 'Battle Royale', icon: '🏆',
    events: [
      { timestamp: 2.0, duration: 0.6, ctaText: 'Drop In!', ctaStyle: 'pulse', ctaSize: 'large', ctaX: 50, ctaY: 80, animation: 'zoom-in' },
      { timestamp: 8.0, duration: 0.6, ctaText: 'Win Royale', ctaStyle: 'glow', ctaSize: 'large', ctaX: 50, ctaY: 82, animation: 'bounce' },
    ],
  },
  {
    id: 'strategy', name: 'Strategy', genre: 'Strategy', icon: '♟️',
    events: [
      { timestamp: 3.0, duration: 0.7, ctaText: 'Command!', ctaStyle: 'glass', ctaSize: 'large', ctaX: 50, ctaY: 80, animation: 'fade-in' },
      { timestamp: 9.0, duration: 0.6, ctaText: 'Conquer', ctaStyle: 'primary', ctaSize: 'medium', ctaX: 50, ctaY: 85, animation: 'slide-up' },
    ],
  },
  {
    id: 'sports', name: 'Sports', genre: 'Sports', icon: '⚽',
    events: [
      { timestamp: 2.0, duration: 0.6, ctaText: 'Play!', ctaStyle: 'floating', ctaSize: 'large', ctaX: 50, ctaY: 80, animation: 'bounce' },
      { timestamp: 7.0, duration: 0.6, ctaText: 'Score Now', ctaStyle: 'glow', ctaSize: 'large', ctaX: 50, ctaY: 82, animation: 'zoom-in' },
    ],
  },
  {
    id: 'casual', name: 'Casual', genre: 'Casual', icon: '🎮',
    events: [
      { timestamp: 2.5, duration: 0.6, ctaText: 'Try Free!', ctaStyle: 'floating', ctaSize: 'large', ctaX: 50, ctaY: 82, animation: 'bounce' },
      { timestamp: 8.0, duration: 0.6, ctaText: 'Play Now', ctaStyle: 'primary', ctaSize: 'medium', ctaX: 50, ctaY: 85, animation: 'fade-in' },
    ],
  },
  {
    id: 'horror', name: 'Horror', genre: 'Horror', icon: '👻',
    events: [
      { timestamp: 2.0, duration: 0.7, ctaText: 'Dare to Play', ctaStyle: 'glass', ctaSize: 'large', ctaX: 50, ctaY: 80, animation: 'shake' },
      { timestamp: 9.0, duration: 0.6, ctaText: 'If You Dare', ctaStyle: 'secondary', ctaSize: 'medium', ctaX: 50, ctaY: 85, animation: 'fade-in' },
    ],
  },
  {
    id: 'idle', name: 'Idle / Clicker', genre: 'Idle', icon: '👆',
    events: [
      { timestamp: 3.0, duration: 0.6, ctaText: 'Tap & Earn!', ctaStyle: 'glow', ctaSize: 'large', ctaX: 50, ctaY: 82, animation: 'pulse' },
      { timestamp: 10.0, duration: 0.6, ctaText: 'Get Rich', ctaStyle: 'floating', ctaSize: 'medium', ctaX: 50, ctaY: 85, animation: 'bounce' },
    ],
  },
  {
    id: 'mmorpg', name: 'MMORPG', genre: 'MMORPG', icon: '🧙',
    events: [
      { timestamp: 1.5, duration: 0.7, ctaText: 'Enter World', ctaStyle: 'glass', ctaSize: 'large', ctaX: 50, ctaY: 78, animation: 'fade-in' },
      { timestamp: 7.0, duration: 0.6, ctaText: 'Join Guild', ctaStyle: 'glow', ctaSize: 'medium', ctaX: 50, ctaY: 82, animation: 'slide-up' },
      { timestamp: 13.0, duration: 0.6, ctaText: 'Play Free', ctaStyle: 'primary', ctaSize: 'large', ctaX: 50, ctaY: 85, animation: 'zoom-in' },
    ],
  },
  {
    id: 'platformer', name: 'Platformer', genre: 'Platformer', icon: '🦘',
    events: [
      { timestamp: 2.0, duration: 0.6, ctaText: 'Jump In!', ctaStyle: 'bounce', ctaSize: 'large', ctaX: 50, ctaY: 80, animation: 'bounce' },
      { timestamp: 8.0, duration: 0.6, ctaText: 'Download', ctaStyle: 'primary', ctaSize: 'medium', ctaX: 50, ctaY: 85, animation: 'slide-up' },
    ],
  },
  {
    id: 'card', name: 'Card Game', genre: 'Card', icon: '🃏',
    events: [
      { timestamp: 2.0, duration: 0.7, ctaText: 'Draw Card!', ctaStyle: 'floating', ctaSize: 'large', ctaX: 50, ctaY: 80, animation: 'zoom-in' },
      { timestamp: 8.0, duration: 0.6, ctaText: 'Build Deck', ctaStyle: 'glass', ctaSize: 'medium', ctaX: 50, ctaY: 84, animation: 'slide-right' },
    ],
  },
  {
    id: 'survival', name: 'Survival', genre: 'Survival', icon: '🪓',
    events: [
      { timestamp: 1.5, duration: 0.6, ctaText: 'Survive!', ctaStyle: 'pulse', ctaSize: 'large', ctaX: 50, ctaY: 80, animation: 'shake' },
      { timestamp: 7.0, duration: 0.6, ctaText: 'Craft & Build', ctaStyle: 'glow', ctaSize: 'medium', ctaX: 50, ctaY: 83, animation: 'zoom-in' },
      { timestamp: 13.0, duration: 0.6, ctaText: 'Play Now', ctaStyle: 'primary', ctaSize: 'large', ctaX: 50, ctaY: 85, animation: 'slide-up' },
    ],
  },
  {
    id: 'simulation', name: 'Simulation', genre: 'Simulation', icon: '🏙️',
    events: [
      { timestamp: 3.0, duration: 0.7, ctaText: 'Build City', ctaStyle: 'glass', ctaSize: 'large', ctaX: 50, ctaY: 80, animation: 'fade-in' },
      { timestamp: 10.0, duration: 0.6, ctaText: 'Download', ctaStyle: 'primary', ctaSize: 'medium', ctaX: 50, ctaY: 85, animation: 'slide-up' },
    ],
  },
];

export function applyTemplate(template: GameTemplate, config: CreativeConfig): CreativeConfig {
  const events = template.events.map(t => ({
    id: Math.random().toString(36).slice(2, 10),
    frameIndex: -1,
    timestamp: t.timestamp,
    duration: t.duration,
    cta: {
      text: t.ctaText,
      position: { x: t.ctaX, y: t.ctaY },
      style: t.ctaStyle,
      size: t.ctaSize,
      visible: true,
      action: 'link' as const,
    },
    overlay: { type: 'none' as const, text: '', position: 'top-right' as const, visible: false },
    animation: t.animation,
    pauseVideo: true,
  }));
  return { ...config, timeline: events };
}
