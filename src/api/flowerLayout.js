// The app's model of the physical flower hardware: how many flowers, which GPIO
// pin each strip is on, how many LEDs per strip, and the layout shape. Drives the
// visualization, the per-flower connection indicators, and pattern math.
//
// This mirrors the firmware's constants.py (NAMES / DATA_PINS / LED_LENGTHS). The
// BLE protocol can't reconfigure the firmware at runtime, so editing this here
// updates the app's picture of the hardware — changing the *physical* wiring/pins
// still needs a firmware reflash to match.

import { getSetting, setSetting } from './appSettings';

const KEY = 'flowerLayout';

export const SHAPES = ['circle', 'line'];

// Default = the current bouquet: 3 flowers, pins 2/3/5, 15 LEDs each, circle.
export const DEFAULT_LAYOUT = {
  flowers: [
    { name: 'Flower 1.1', pin: 2, ledCount: 15, shape: 'circle' },
    { name: 'Flower 1.2', pin: 3, ledCount: 15, shape: 'circle' },
    { name: 'Flower 1.3', pin: 5, ledCount: 15, shape: 'circle' },
  ],
};

function sanitize(layout) {
  if (!layout || !Array.isArray(layout.flowers) || !layout.flowers.length) return null;
  const flowers = layout.flowers.slice(0, 16).map((f, i) => ({
    name: String(f?.name ?? `Flower ${i + 1}`).slice(0, 40),
    pin: Number.isFinite(+f?.pin) ? Math.max(0, Math.min(48, Math.round(+f.pin))) : 0,
    ledCount: Number.isFinite(+f?.ledCount) ? Math.max(1, Math.min(300, Math.round(+f.ledCount))) : 15,
    shape: SHAPES.includes(f?.shape) ? f.shape : 'circle',
  }));
  return { flowers };
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

export function newFlower(index) {
  return { name: `Flower ${index + 1}`, pin: 0, ledCount: 15, shape: 'circle' };
}
