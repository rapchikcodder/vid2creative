import React from 'react';
import type { Layer, LayerType } from '../lib/types';

const TYPE_ICON: Record<LayerType, string> = {
  text: 'T',
  image: '🖼',
  tutorial: '👆',
  progress: '▬',
  effect: '✨',
  shape: '⬛',
};

interface Props {
  layer: Layer;
  isSelected: boolean;
  onSelect: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

export default function LayerItem({
  layer, isSelected, onSelect,
  onToggleVisible, onToggleLock, onDelete, onDuplicate,
  dragHandleProps,
}: Props) {
  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer group select-none
        ${isSelected ? 'bg-indigo-900/60 ring-1 ring-indigo-500' : 'hover:bg-gray-800'}`}
    >
      {/* Drag handle */}
      <div
        {...dragHandleProps}
        className="text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing px-0.5 flex-shrink-0"
        onClick={e => e.stopPropagation()}
      >
        ⣿
      </div>

      {/* Type icon */}
      <span className="text-xs w-5 flex-shrink-0 text-center opacity-70">
        {TYPE_ICON[layer.type]}
      </span>

      {/* Name */}
      <span className={`flex-1 text-sm truncate ${!layer.visible ? 'opacity-40' : ''}`}>
        {layer.name}
      </span>

      {/* Controls — visible on hover / when selected */}
      <div className={`flex items-center gap-1 flex-shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <button
          className="text-xs text-gray-400 hover:text-white w-5 h-5 flex items-center justify-center"
          title="Duplicate"
          onClick={e => { e.stopPropagation(); onDuplicate(); }}
        >⎘</button>
        <button
          className={`text-xs w-5 h-5 flex items-center justify-center ${layer.locked ? 'text-yellow-400' : 'text-gray-400 hover:text-white'}`}
          title={layer.locked ? 'Unlock' : 'Lock'}
          onClick={e => { e.stopPropagation(); onToggleLock(); }}
        >{layer.locked ? '🔒' : '🔓'}</button>
        <button
          className={`text-xs w-5 h-5 flex items-center justify-center ${layer.visible ? 'text-gray-400 hover:text-white' : 'text-gray-600'}`}
          title={layer.visible ? 'Hide' : 'Show'}
          onClick={e => { e.stopPropagation(); onToggleVisible(); }}
        >{layer.visible ? '👁' : '👁‍🗨'}</button>
        <button
          className="text-xs text-red-500 hover:text-red-400 w-5 h-5 flex items-center justify-center"
          title="Delete"
          onClick={e => { e.stopPropagation(); onDelete(); }}
        >×</button>
      </div>
    </div>
  );
}
