// The app's model of the physical hardware: a list of bouquets, each driven by its
// own ESP32 and holding (by default) three flowers. Per flower we keep the GPIO pin,
// LED count, and layout shape. Drives the visualization, connection indicators, and
// pattern math. Mirrors the firmware's constants.py per bouquet.

import { getSetting, setSetting } from './appSettings';

const KEY = 'flowerLayout';

export const SHAPES = ['circle', 'line'];

function sanFlower(f, i) {
  return {
    name: String(f?.name ?? `Flower ${i + 1}`).slice(0, 40),
    pin: Number.isFinite(+f?.pin) ? Math.max(0, Math.min(48, Math.round(+f.pin))) : 0,
    ledCount: Number.isFinite(+f?.ledCount) ? Math.max(1, Math.min(300, Math.round(+f.ledCount))) : 15,
    shape: SHAPES.includes(f?.shape) ? f.shape : 'circle',
    // Optional manual position within the bouquet cluster (px in the 124×108 box).
    ...(Number.isFinite(+f?.fx) ? { fx: +f.fx } : {}),
    ...(Number.isFinite(+f?.fy) ? { fy: +f.fy } : {}),
  };
}

// Default canvas position (0..1) for the nth bouquet, laid out in a loose grid.
export function defaultPos(i) {
  const col = i % 3;
  const row = Math.floor(i / 3);
  return { x: Math.min(0.85, 0.2 + col * 0.3), y: Math.min(0.8, 0.3 + row * 0.34) };
}

// A fresh bouquet = 3 flowers on the standard pins, placed on the canvas.
export function newBouquet(index) {
  const n = index + 1;
  const p = defaultPos(index);
  return {
    name: `Bouquet ${n}`,
    x: p.x,
    y: p.y,
    flowers: [
      { name: `Flower ${n}.1`, pin: 2, ledCount: 15, shape: 'circle' },
      { name: `Flower ${n}.2`, pin: 3, ledCount: 15, shape: 'circle' },
      { name: `Flower ${n}.3`, pin: 5, ledCount: 15, shape: 'circle' },
    ],
  };
}

// Default = one bouquet (the current rig).
export const DEFAULT_LAYOUT = { bouquets: [newBouquet(0)] };

// Accept the new shape ({ bouquets }) or migrate the old flat shape ({ flowers }).
function sanitize(layout) {
  if (!layout) return null;
  let bouquets;
  if (Array.isArray(layout.bouquets)) bouquets = layout.bouquets;
  else if (Array.isArray(layout.flowers)) bouquets = [{ name: 'Bouquet 1', flowers: layout.flowers }];
  else return null;
  bouquets = bouquets.slice(0, 8).map((b, bi) => {
    const p = defaultPos(bi);
    return {
      name: String(b?.name ?? `Bouquet ${bi + 1}`).slice(0, 40),
      x: Number.isFinite(+b?.x) ? Math.max(0, Math.min(1, +b.x)) : p.x,
      y: Number.isFinite(+b?.y) ? Math.max(0, Math.min(1, +b.y)) : p.y,
      flowers: (Array.isArray(b?.flowers) ? b.flowers : []).slice(0, 12).map(sanFlower),
    };
  }).filter((b) => b.flowers.length);
  if (!bouquets.length) return null;
  return { bouquets };
}

export async function loadLayout() {
  const raw = await getSetting(KEY);
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return sanitize(parsed) || DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export async function saveLayout(layout) {
  const clean = sanitize(layout) || DEFAULT_LAYOUT;
  await setSetting(KEY, JSON.stringify(clean));
  return clean;
}

// All flowers across every bouquet, in order — the global index matches the order
// commands/connection channels are assigned in.
export function allFlowers(layout) {
  return (layout?.bouquets || []).flatMap((b) => b.flowers);
}

export function totalFlowers(layout) {
  return allFlowers(layout).length;
}
