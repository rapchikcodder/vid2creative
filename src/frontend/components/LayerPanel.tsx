import React from 'react';
import type { Layer, LayerType } from '../lib/types';
import LayerItem from './LayerItem';

const LAYER_TYPES: { type: LayerType; label: string }[] = [
  { type: 'text', label: 'Text' },
  { type: 'image', label: 'Image' },
  { type: 'shape', label: 'Shape' },
  { type: 'progress', label: 'Progress' },
  { type: 'effect', label: 'Effect' },
  { type: 'tutorial', label: 'Tutorial' },
];

interface Props {
  layers: Layer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (type: LayerType) => void;
  onUpdate: (id: string, patch: Partial<Omit<Layer, 'id' | 'type'>>) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
}

export default function LayerPanel({
  layers, selectedId, onSelect, onAdd, onUpdate, onRemove, onDuplicate, onReorder,
}: Props) {
  const [showAddMenu, setShowAddMenu] = React.useState(false);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dragOverId, setDragOverId] = React.useState<string | null>(null);

  // Layers rendered top = highest zIndex (visually on top)
  const sorted = [...layers].sort((a, b) => b.zIndex - a.zIndex);

  function handleDragStart(id: string) {
    setDraggingId(id);
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    setDragOverId(id);
  }

  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    const ids = sorted.map(l => l.id);
    const fromIdx = ids.indexOf(draggingId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, draggingId);
    // ids is sorted top→bottom (high zIndex first), reverse for reorderLayers (low→high)
    onReorder([...ids].reverse());
    setDraggingId(null);
    setDragOverId(null);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Layers</span>
        <div className="relative">
          <button
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded flex items-center gap-1"
            onClick={() => setShowAddMenu(v => !v)}
          >
            + Add
          </button>
          {showAddMenu && (
            <div className="absolute right-0 top-8 z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[120px]">
              {LAYER_TYPES.map(({ type, label }) => (
                <button
                  key={type}
                  className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-700 text-gray-200"
                  onClick={() => { onAdd(type); setShowAddMenu(false); }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {layers.length === 0 && (
          <p className="text-xs text-gray-600 text-center py-6 px-3">
            No layers yet. Click "+ Add" to add a text, image, or shape layer.
          </p>
        )}
        {sorted.map(layer => (
          <div
            key={layer.id}
            draggable
            onDragStart={() => handleDragStart(layer.id)}
            onDragOver={e => handleDragOver(e, layer.id)}
            onDrop={() => handleDrop(layer.id)}
            onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
            className={`transition-all ${
              dragOverId === layer.id && draggingId !== layer.id
                ? 'border-t-2 border-indigo-400'
                : ''
            } ${draggingId === layer.id ? 'opacity-40' : ''}`}
          >
            <LayerItem
              layer={layer}
              isSelected={selectedId === layer.id}
              onSelect={() => onSelect(layer.id)}
              onToggleVisible={() => onUpdate(layer.id, { visible: !layer.visible })}
              onToggleLock={() => onUpdate(layer.id, { locked: !layer.locked })}
              onDelete={() => onRemove(layer.id)}
              onDuplicate={() => onDuplicate(layer.id)}
              dragHandleProps={{ draggable: false }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
