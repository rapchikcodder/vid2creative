import React, { useRef, useState, useCallback } from 'react';
import type { Layer } from '../lib/types';
import LayerRenderer from './LayerRenderer';

interface Props {
  layers: Layer[];
  selectedId: string | null;
  currentTime?: number;
  containerWidth: number;
  containerHeight: number;
  onSelectLayer: (id: string | null) => void;
  onUpdateLayer: (id: string, patch: Partial<Omit<Layer, 'id' | 'type'>>) => void;
  children?: React.ReactNode; // video element slot
}

interface DragState {
  layerId: string;
  startMouseX: number;
  startMouseY: number;
  startPosX: number;
  startPosY: number;
}

/**
 * LayerCanvas — wraps the video preview and renders Layer[] as abs-positioned divs on top.
 * Supports click-to-select and drag-to-reposition (non-locked layers only).
 */
export default function LayerCanvas({
  layers, selectedId, currentTime = 0,
  containerWidth, containerHeight,
  onSelectLayer, onUpdateLayer,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Filter to layers visible at currentTime
  const visibleLayers = layers.filter(l => {
    if (!l.visible) return false;
    if (l.showAt !== undefined && currentTime < l.showAt) return false;
    if (l.hideAt !== undefined && currentTime >= l.hideAt) return false;
    return true;
  });

  const handleMouseDown = useCallback((e: React.MouseEvent, layer: Layer) => {
    if (layer.locked) return;
    e.stopPropagation();
    onSelectLayer(layer.id);
    dragRef.current = {
      layerId: layer.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPosX: layer.position.x,
      startPosY: layer.position.y,
    };
    setIsDragging(true);
  }, [onSelectLayer]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const { layerId, startMouseX, startMouseY, startPosX, startPosY } = dragRef.current;
    const dx = ((e.clientX - startMouseX) / containerWidth) * 100;
    const dy = ((e.clientY - startMouseY) / containerHeight) * 100;
    onUpdateLayer(layerId, {
      position: {
        x: Math.round((startPosX + dx) * 10) / 10,
        y: Math.round((startPosY + dy) * 10) / 10,
      },
    });
  }, [containerWidth, containerHeight, onUpdateLayer]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: containerWidth, height: containerHeight, position: 'relative', overflow: 'hidden' }}
      className="select-none"
      onMouseMove={isDragging ? handleMouseMove : undefined}
      onMouseUp={isDragging ? handleMouseUp : undefined}
      onMouseLeave={isDragging ? handleMouseUp : undefined}
      onClick={() => onSelectLayer(null)}
    >
      {/* Video / poster slot */}
      {children}

      {/* Layers */}
      {visibleLayers.map(layer => (
        <div
          key={layer.id}
          style={{
            position: 'absolute',
            left: (layer.position.x / 100) * containerWidth,
            top: (layer.position.y / 100) * containerHeight,
            width: (layer.size.width / 100) * containerWidth,
            height: (layer.size.height / 100) * containerHeight,
            zIndex: layer.zIndex + 10,
            cursor: layer.locked ? 'default' : 'move',
            outline: selectedId === layer.id ? '2px solid #6366f1' : 'none',
            outlineOffset: '1px',
            transform: `rotate(${layer.rotation}deg)`,
          }}
          onMouseDown={e => handleMouseDown(e, layer)}
          onClick={e => { e.stopPropagation(); onSelectLayer(layer.id); }}
        >
          <LayerRenderer
            layer={layer}
            containerWidth={(layer.size.width / 100) * containerWidth}
            containerHeight={(layer.size.height / 100) * containerHeight}
          />
        </div>
      ))}
    </div>
  );
}
