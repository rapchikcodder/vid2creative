import React from 'react';
import type {
  Layer, LayerData,
  TextLayerData, ImageLayerData, ProgressLayerData,
  EffectLayerData, TutorialLayerData, ShapeLayerData,
  AnimationType,
} from '../lib/types';

const ANIMATION_OPTIONS: AnimationType[] = [
  'fade-in', 'slide-up', 'slide-left', 'slide-right',
  'zoom-in', 'bounce', 'pulse', 'glow', 'shake',
];

interface Props {
  layer: Layer;
  onUpdate: (patch: Partial<Omit<Layer, 'id' | 'type'>>) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">{label}</label>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, min = 0, max = 100, step = 1 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-full"
    />
  );
}

function TextInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-full"
    />
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-8 h-8 rounded cursor-pointer border border-gray-700 bg-transparent"
      />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm flex-1"
      />
    </div>
  );
}

function updateData<T extends LayerData>(
  layer: Layer, patch: Partial<T>, onUpdate: Props['onUpdate']
) {
  onUpdate({ data: { ...layer.data, ...patch } as LayerData });
}

// ---- Type-specific sub-editors ----

function TextEditor({ layer, onUpdate }: Props) {
  const d = layer.data as TextLayerData;
  return (
    <>
      <Field label="Text">
        <textarea
          value={d.text}
          onChange={e => updateData(layer, { text: e.target.value }, onUpdate)}
          rows={2}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-full resize-none"
        />
      </Field>
      <Field label="Font size">
        <NumInput value={d.fontSize} min={8} max={200} onChange={v => updateData(layer, { fontSize: v }, onUpdate)} />
      </Field>
      <Field label="Color">
        <ColorInput value={d.fontColor} onChange={v => updateData(layer, { fontColor: v }, onUpdate)} />
      </Field>
      <Field label="Font family">
        <select
          value={d.fontFamily}
          onChange={e => updateData(layer, { fontFamily: e.target.value }, onUpdate)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-full"
        >
          {['sans-serif', 'serif', 'monospace', 'Arial', 'Georgia', 'Impact'].map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </Field>
      <Field label="Align">
        <div className="flex gap-1">
          {(['left', 'center', 'right'] as const).map(a => (
            <button
              key={a}
              onClick={() => updateData(layer, { textAlign: a }, onUpdate)}
              className={`flex-1 py-1 text-xs rounded border ${d.textAlign === a ? 'border-indigo-500 bg-indigo-900/40 text-indigo-300' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}
            >{a}</button>
          ))}
        </div>
      </Field>
      <div className="flex gap-3">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" checked={d.bold} onChange={e => updateData(layer, { bold: e.target.checked }, onUpdate)} />
          Bold
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" checked={d.italic} onChange={e => updateData(layer, { italic: e.target.checked }, onUpdate)} />
          Italic
        </label>
      </div>
      <Field label="Background">
        <ColorInput
          value={d.backgroundColor ?? 'transparent'}
          onChange={v => updateData(layer, { backgroundColor: v === 'transparent' ? undefined : v }, onUpdate)}
        />
      </Field>
    </>
  );
}

function ImageEditor({ layer, onUpdate }: Props) {
  const d = layer.data as ImageLayerData;
  return (
    <>
      <Field label="Image URL">
        <TextInput value={d.src} onChange={v => updateData(layer, { src: v }, onUpdate)} />
      </Field>
      <Field label="Object fit">
        <select
          value={d.objectFit}
          onChange={e => updateData(layer, { objectFit: e.target.value as ImageLayerData['objectFit'] }, onUpdate)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-full"
        >
          <option value="contain">Contain</option>
          <option value="cover">Cover</option>
          <option value="fill">Fill</option>
        </select>
      </Field>
    </>
  );
}

function ProgressEditor({ layer, onUpdate }: Props) {
  const d = layer.data as ProgressLayerData;
  return (
    <>
      <Field label="Bar type">
        <select
          value={d.barType}
          onChange={e => updateData(layer, { barType: e.target.value as ProgressLayerData['barType'] }, onUpdate)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-full"
        >
          <option value="linear">Linear</option>
          <option value="circular">Circular</option>
        </select>
      </Field>
      <Field label="Fill %">
        <NumInput value={d.fillPercent} min={0} max={100} onChange={v => updateData(layer, { fillPercent: v }, onUpdate)} />
      </Field>
      <Field label="Fill color"><ColorInput value={d.color} onChange={v => updateData(layer, { color: v }, onUpdate)} /></Field>
      <Field label="Track color"><ColorInput value={d.backgroundColor} onChange={v => updateData(layer, { backgroundColor: v }, onUpdate)} /></Field>
    </>
  );
}

function AssetEditor({ layer, onUpdate, label }: Props & { label: string }) {
  const d = layer.data as EffectLayerData | TutorialLayerData;
  return (
    <>
      <Field label={`${label} URL`}>
        <TextInput value={d.assetUrl} onChange={v => updateData(layer, { assetUrl: v }, onUpdate)} />
      </Field>
      {'loop' in d && (
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" checked={(d as EffectLayerData).loop}
            onChange={e => updateData(layer, { loop: e.target.checked }, onUpdate)} />
          Loop
        </label>
      )}
    </>
  );
}

function ShapeEditor({ layer, onUpdate }: Props) {
  const d = layer.data as ShapeLayerData;
  return (
    <>
      <Field label="Shape">
        <select
          value={d.shape}
          onChange={e => updateData(layer, { shape: e.target.value as ShapeLayerData['shape'] }, onUpdate)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-full"
        >
          <option value="rectangle">Rectangle</option>
          <option value="circle">Circle</option>
          <option value="triangle">Triangle</option>
        </select>
      </Field>
      <Field label="Fill color"><ColorInput value={d.fillColor} onChange={v => updateData(layer, { fillColor: v }, onUpdate)} /></Field>
      <Field label="Border color">
        <ColorInput value={d.borderColor ?? '#000000'} onChange={v => updateData(layer, { borderColor: v }, onUpdate)} />
      </Field>
      <Field label="Border width">
        <NumInput value={d.borderWidth} min={0} max={20} onChange={v => updateData(layer, { borderWidth: v }, onUpdate)} />
      </Field>
      {d.shape === 'rectangle' && (
        <Field label="Border radius">
          <NumInput value={d.borderRadius ?? 0} min={0} max={100} onChange={v => updateData(layer, { borderRadius: v }, onUpdate)} />
        </Field>
      )}
    </>
  );
}

// ---- Main panel ----

export default function LayerPropertiesPanel({ layer, onUpdate }: Props) {
  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto">
      {/* Name */}
      <Field label="Name">
        <TextInput value={layer.name} onChange={v => onUpdate({ name: v })} />
      </Field>

      {/* Position + size */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="X (%)"><NumInput value={Math.round(layer.position.x)} min={-50} max={150} onChange={v => onUpdate({ position: { ...layer.position, x: v } })} /></Field>
        <Field label="Y (%)"><NumInput value={Math.round(layer.position.y)} min={-50} max={150} onChange={v => onUpdate({ position: { ...layer.position, y: v } })} /></Field>
        <Field label="W (%)"><NumInput value={Math.round(layer.size.width)} min={1} max={200} onChange={v => onUpdate({ size: { ...layer.size, width: v } })} /></Field>
        <Field label="H (%)"><NumInput value={Math.round(layer.size.height)} min={1} max={200} onChange={v => onUpdate({ size: { ...layer.size, height: v } })} /></Field>
      </div>

      {/* Rotation + opacity */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Rotation">
          <NumInput value={layer.rotation} min={-180} max={180} onChange={v => onUpdate({ rotation: v })} />
        </Field>
        <Field label="Opacity">
          <NumInput value={Math.round(layer.opacity * 100)} min={0} max={100} onChange={v => onUpdate({ opacity: v / 100 })} />
        </Field>
      </div>

      {/* Timing */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Show at (s)">
          <input
            type="number"
            placeholder="always"
            value={layer.showAt ?? ''}
            min={0}
            step={0.1}
            onChange={e => onUpdate({ showAt: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-full"
          />
        </Field>
        <Field label="Hide at (s)">
          <input
            type="number"
            placeholder="never"
            value={layer.hideAt ?? ''}
            min={0}
            step={0.1}
            onChange={e => onUpdate({ hideAt: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-full"
          />
        </Field>
      </div>

      {/* Animation */}
      <Field label="Animation">
        <select
          value={layer.animation ?? ''}
          onChange={e => onUpdate({ animation: e.target.value === '' ? undefined : e.target.value as AnimationType })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-full"
        >
          <option value="">None</option>
          {ANIMATION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </Field>

      <hr className="border-gray-800" />

      {/* Type-specific editors */}
      {layer.type === 'text' && <TextEditor layer={layer} onUpdate={onUpdate} />}
      {layer.type === 'image' && <ImageEditor layer={layer} onUpdate={onUpdate} />}
      {layer.type === 'progress' && <ProgressEditor layer={layer} onUpdate={onUpdate} />}
      {layer.type === 'effect' && <AssetEditor layer={layer} onUpdate={onUpdate} label="Effect GIF" />}
      {layer.type === 'tutorial' && <AssetEditor layer={layer} onUpdate={onUpdate} label="Tutorial image" />}
      {layer.type === 'shape' && <ShapeEditor layer={layer} onUpdate={onUpdate} />}
    </div>
  );
}
