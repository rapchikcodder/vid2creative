import React from 'react';
import { TEMPLATES, applyTemplate, type GameTemplate } from '../lib/templates';
import type { CreativeConfig } from '../lib/types';

interface Props {
  config: CreativeConfig;
  onApply: (config: CreativeConfig) => void;
  onClear: () => void;
}

export default function TemplateSelector({ config, onApply, onClear }: Props) {
  function handleApply(template: GameTemplate) {
    onApply(applyTemplate(template, config));
  }

  return (
    <div className="p-3 bg-gray-950 border-b border-gray-800">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Game Templates</span>
        <button
          onClick={onClear}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded hover:bg-gray-800">
          Clear Timeline
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TEMPLATES.map(t => (
          <button
            key={t.id}
            onClick={() => handleApply(t)}
            className="flex items-center gap-1 bg-gray-800 hover:bg-indigo-900/60 border border-gray-700 hover:border-indigo-600 text-xs px-2 py-1 rounded-md transition-colors"
            title={`${t.genre} — ${t.events.length} CTAs`}
          >
            <span>{t.icon}</span>
            <span>{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
