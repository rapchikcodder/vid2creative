import { useCallback } from 'react';
import type { Layer, LayerType, LayerData, CreativeConfig } from '../lib/types';

// Default data per layer type
function defaultData(type: LayerType): LayerData {
  switch (type) {
    case 'text':
      return {
        kind: 'text',
        text: 'New Text',
        fontSize: 24,
        fontColor: '#ffffff',
        fontFamily: 'sans-serif',
        bold: false,
        italic: false,
        textAlign: 'center',
      };
    case 'image':
      return { kind: 'image', src: '', objectFit: 'contain' };
    case 'tutorial':
      return { kind: 'tutorial', assetId: '', assetUrl: '' };
    case 'progress':
      return { kind: 'progress', barType: 'linear', color: '#6366f1', backgroundColor: '#1f2937', fillPercent: 70 };
    case 'effect':
      return { kind: 'effect', assetId: '', assetUrl: '', loop: true };
    case 'shape':
      return { kind: 'shape', shape: 'rectangle', fillColor: '#6366f1', borderWidth: 0 };
  }
}

function defaultLayerName(type: LayerType, existingCount: number): string {
  const base: Record<LayerType, string> = {
    text: 'Text',
    image: 'Image',
    tutorial: 'Tutorial',
    progress: 'Progress Bar',
    effect: 'Effect',
    shape: 'Shape',
  };
  return `${base[type]} ${existingCount + 1}`;
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface UseLayersReturn {
  addLayer: (type: LayerType) => void;
  updateLayer: (id: string, patch: Partial<Omit<Layer, 'id' | 'type'>>) => void;
  removeLayer: (id: string) => void;
  reorderLayers: (orderedIds: string[]) => void;
  duplicateLayer: (id: string) => void;
  selectLayer: (id: string | null) => void;
}

export function useLayers(
  config: CreativeConfig,
  onConfigChange: (next: CreativeConfig) => void,
  selectedLayerId: string | null,
  setSelectedLayerId: (id: string | null) => void,
): UseLayersReturn {

  const addLayer = useCallback((type: LayerType) => {
    const layers = config.layers ?? [];
    const newLayer: Layer = {
      id: makeId(),
      type,
      name: defaultLayerName(type, layers.length),
      visible: true,
      locked: false,
      position: { x: 25, y: 25 },
      size: { width: 50, height: type === 'text' ? 10 : 20 },
      rotation: 0,
      opacity: 1,
      zIndex: layers.length,
      data: defaultData(type),
    };
    const updated = { ...config, layers: [...layers, newLayer] };
    onConfigChange(updated);
    setSelectedLayerId(newLayer.id);
  }, [config, onConfigChange, setSelectedLayerId]);

  const updateLayer = useCallback((id: string, patch: Partial<Omit<Layer, 'id' | 'type'>>) => {
    const layers = (config.layers ?? []).map(l =>
      l.id === id ? { ...l, ...patch } : l
    );
    onConfigChange({ ...config, layers });
  }, [config, onConfigChange]);

  const removeLayer = useCallback((id: string) => {
    const layers = (config.layers ?? []).filter(l => l.id !== id);
    onConfigChange({ ...config, layers });
    if (selectedLayerId === id) setSelectedLayerId(null);
  }, [config, onConfigChange, selectedLayerId, setSelectedLayerId]);

  const reorderLayers = useCallback((orderedIds: string[]) => {
    const map = new Map((config.layers ?? []).map(l => [l.id, l]));
    const layers = orderedIds
      .map((id, i) => {
        const l = map.get(id);
        return l ? { ...l, zIndex: i } : null;
      })
      .filter((l): l is Layer => l !== null);
    onConfigChange({ ...config, layers });
  }, [config, onConfigChange]);

  const duplicateLayer = useCallback((id: string) => {
    const layers = config.layers ?? [];
    const src = layers.find(l => l.id === id);
    if (!src) return;
    const copy: Layer = {
      ...src,
      id: makeId(),
      name: `${src.name} Copy`,
      position: { x: src.position.x + 2, y: src.position.y + 2 },
      zIndex: layers.length,
    };
    onConfigChange({ ...config, layers: [...layers, copy] });
    setSelectedLayerId(copy.id);
  }, [config, onConfigChange, setSelectedLayerId]);

  const selectLayer = useCallback((id: string | null) => {
    setSelectedLayerId(id);
  }, [setSelectedLayerId]);

  return { addLayer, updateLayer, removeLayer, reorderLayers, duplicateLayer, selectLayer };
}
