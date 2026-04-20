import React from 'react';
import type { Layer } from '../lib/types';

interface Props {
  layer: Layer;
  containerWidth: number;
  containerHeight: number;
}

/**
 * Renders a single Layer as an absolutely-positioned DOM element.
 * Used by LayerCanvas (preview) and by html-generator (export via string serialization).
 */
export default function LayerRenderer({ layer, containerWidth, containerHeight }: Props) {
  if (!layer.visible) return null;

  const left = (layer.position.x / 100) * containerWidth;
  const top = (layer.position.y / 100) * containerHeight;
  const width = (layer.size.width / 100) * containerWidth;
  const height = (layer.size.height / 100) * containerHeight;

  const wrapStyle: React.CSSProperties = {
    position: 'absolute',
    left,
    top,
    width,
    height,
    transform: `rotate(${layer.rotation}deg)`,
    opacity: layer.opacity,
    zIndex: layer.zIndex,
    pointerEvents: 'none',
    overflow: 'hidden',
  };

  const { data } = layer;

  if (data.kind === 'text') {
    return (
      <div style={{
        ...wrapStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: data.textAlign === 'left' ? 'flex-start'
          : data.textAlign === 'right' ? 'flex-end' : 'center',
        backgroundColor: data.backgroundColor ?? 'transparent',
        padding: '4px 8px',
        boxSizing: 'border-box',
      }}>
        <span style={{
          fontSize: data.fontSize,
          color: data.fontColor,
          fontFamily: data.fontFamily,
          fontWeight: data.bold ? 'bold' : 'normal',
          fontStyle: data.italic ? 'italic' : 'normal',
          textAlign: data.textAlign,
          width: '100%',
          wordBreak: 'break-word',
        }}>
          {data.text}
        </span>
      </div>
    );
  }

  if (data.kind === 'image') {
    if (!data.src) return <div style={{ ...wrapStyle, background: '#1f2937', border: '1px dashed #4b5563' }} />;
    return (
      <img
        src={data.src}
        alt={data.alt ?? ''}
        style={{ ...wrapStyle, objectFit: data.objectFit }}
      />
    );
  }

  if (data.kind === 'tutorial' || data.kind === 'effect') {
    if (!data.assetUrl) return <div style={{ ...wrapStyle, background: '#1f2937', border: '1px dashed #4b5563' }} />;
    return (
      <img
        src={data.assetUrl}
        alt={layer.name}
        style={{ ...wrapStyle, objectFit: 'contain' }}
      />
    );
  }

  if (data.kind === 'progress') {
    if (data.barType === 'linear') {
      return (
        <div style={{ ...wrapStyle, backgroundColor: data.backgroundColor, borderRadius: 4 }}>
          <div style={{
            width: `${data.fillPercent}%`,
            height: '100%',
            backgroundColor: data.color,
            borderRadius: 4,
            transition: 'width 0.3s ease',
          }} />
        </div>
      );
    }
    // Circular — simple SVG ring
    const r = 40;
    const circ = 2 * Math.PI * r;
    const stroke = circ * (1 - data.fillPercent / 100);
    return (
      <div style={{ ...wrapStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg viewBox="0 0 100 100" width={width} height={height}>
          <circle cx="50" cy="50" r={r} fill="none" stroke={data.backgroundColor} strokeWidth="10" />
          <circle
            cx="50" cy="50" r={r} fill="none" stroke={data.color} strokeWidth="10"
            strokeDasharray={circ} strokeDashoffset={stroke}
            transform="rotate(-90 50 50)"
          />
        </svg>
      </div>
    );
  }

  if (data.kind === 'shape') {
    const shapeStyle: React.CSSProperties = {
      ...wrapStyle,
      backgroundColor: data.fillColor,
      border: data.borderColor ? `${data.borderWidth}px solid ${data.borderColor}` : 'none',
      borderRadius: data.shape === 'circle' ? '50%'
        : data.borderRadius ? `${data.borderRadius}px` : undefined,
    };
    if (data.shape === 'triangle') {
      return (
        <div style={{ ...wrapStyle, background: 'transparent' }}>
          <div style={{
            width: 0, height: 0,
            borderLeft: `${width / 2}px solid transparent`,
            borderRight: `${width / 2}px solid transparent`,
            borderBottom: `${height}px solid ${data.fillColor}`,
          }} />
        </div>
      );
    }
    return <div style={shapeStyle} />;
  }

  return null;
}
