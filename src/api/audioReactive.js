// Real-time audio analysis for driving the flowers to music.
//
// Captures audio from the microphone or a browser tab (Web Audio API), runs an
// FFT, and on every animation frame emits a normalized energy `level` (0..1), a
// `bass` level, and a `beat` flag (adaptive threshold on bass energy). The caller
// maps these onto flower commands.
//
// Mic vs tab:
//  - 'mic'  → getUserMedia({ audio }). Works with ANY source playing in the room
//    (Spotify desktop, Apple Music, vinyl). Picks up ambient noise.
//  - 'tab'  → getDisplayMedia({ video, audio }). Clean digital audio straight from
//    a Chrome tab; the user must tick "Share tab audio". macOS can't capture
//    native-app / full-system audio this way, so the tab route only covers audio
//    playing inside a browser tab. We request video (required for the picker) then
//    immediately drop the video track.

export function hsvToHex(h, s, v) {
  // h in [0,360), s,v in [0,1] → '#rrggbb'
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0; let g = 0; let b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  const to = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export class AudioReactor {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.raf = null;
    this.data = null;
    this.bassAvg = 0;
    this.lastBeat = 0;
    this.onFrame = null; // ({ level, bass, beat }) => void
  }

  get running() { return !!this.raf; }

  async start(source = 'mic') {
    if (source === 'tab') {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Tab capture is not supported in this browser.');
      }
      this.stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      // We only want the audio; stop the video track so we're not screen-grabbing.
      this.stream.getVideoTracks().forEach((t) => t.stop());
      if (!this.stream.getAudioTracks().length) {
        this.stop();
        throw new Error('No tab audio captured. Re-share and tick "Share tab audio".');
      }
    } else {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone capture is not supported in this browser.');
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.7;
    src.connect(this.analyser);
    this.data = new Uint8Array(this.analyser.frequencyBinCount);

    // If the user stops sharing from the browser's own UI, tear down cleanly.
    this.stream.getTracks().forEach((t) => {
      t.addEventListener('ended', () => { if (this.onEnded) this.onEnded(); this.stop(); });
    });

    this._loop();
  }

  _loop = () => {
    this.raf = requestAnimationFrame(this._loop);
    const a = this.analyser;
    if (!a) return;
    a.getByteFrequencyData(this.data);
    const bins = this.data;
    const n = bins.length;
    const bassEnd = Math.max(2, Math.floor(n * 0.08));
    let bass = 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      total += bins[i];
      if (i < bassEnd) bass += bins[i];
    }
    const bassNorm = bass / (bassEnd * 255);
    const level = total / (n * 255);

    // Adaptive beat detection: flag when instantaneous bass jumps well above its
    // running average, with a debounce so we don't double-trigger.
    this.bassAvg = this.bassAvg * 0.92 + bassNorm * 0.08;
    const now = performance.now();
    let beat = false;
    if (bassNorm > this.bassAvg * 1.35 && bassNorm > 0.1 && now - this.lastBeat > 170) {
      beat = true;
      this.lastBeat = now;
    }

    if (this.onFrame) this.onFrame({ level, bass: bassNorm, beat });
  };

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) { try { this.ctx.close(); } catch { /* already closed */ } }
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
  }
}
