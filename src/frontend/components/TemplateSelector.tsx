import React, { useState } from 'react';
import { TEMPLATES, applyTemplate, type GameTemplate } from '../lib/templates';
import type { CreativeConfig } from '../lib/types';

interface Props {
  config: CreativeConfig;
  onApply: (config: CreativeConfig) => void;
  onClear: () => void;
}

export default function TemplateSelector({ config, onApply, onClear }: Props) {
  const [appliedId, setAppliedId] = useState<string | null>(null);

  function handleApply(template: GameTemplate) {
    onApply(applyTemplate(template, config));
    setAppliedId(template.id);
    setTimeout(() => setAppliedId(null), 1200);
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px 4px',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '.08em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
          {TEMPLATES.length} templates
        </span>
        <button
          onClick={onClear}
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 9, padding: '3px 8px', color: 'var(--text-3)' }}
        >
          Clear
        </button>
      </div>
      <div className="template-card-grid">
        {TEMPLATES.map(t => (
          <button
            key={t.id}
            className={`template-card${appliedId === t.id ? ' applied' : ''}`}
            onClick={() => handleApply(t)}
            title={`${t.genre} — ${t.events.length} CTAs`}
          >
            <span className="template-card-icon">{t.icon}</span>
            <span className="template-card-name">{t.name}</span>
            <span className="template-card-count">{t.events.length} CTAs</span>
          </button>
        ))}
      </div>
    </div>
  );
}
