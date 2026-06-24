// Override-password authentication — a client-side gate for sensitive app actions
// and builds. The user sets an override password; entering it once authorizes
// THIS device for 24 hours (stored locally), after which re-entry is required.
//
// Scope note: this is a local, per-device convenience gate (the hash never leaves
// the device, so it's defense against casual access on a shared machine — not a
// server-enforced boundary). It's separate from the backend's per-command
// "Allow once" approval password used by the Jarvis Agent's /approve route.

const LS_HASH = 'override_pw_hash';
const LS_SALT = 'override_pw_salt';
const LS_UNTIL = 'override_auth_until'; // ms timestamp this device stays authorized until
const PEPPER = 'vertex-override-v1';    // app-level pepper so the stored hash isn't a bare SHA of the pw

export const AUTH_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MIN_PASSWORD_LENGTH = 4;

function emitChange() {
  try { window.dispatchEvent(new Event('override-auth-change')); } catch { /* SSR/no-DOM */ }
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// A stable per-install salt so the same password hashes differently across devices.
function getSalt() {
  let s = localStorage.getItem(LS_SALT);
  if (!s) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    s = [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(LS_SALT, s);
  }
  return s;
}

async function hashPw(pw) {
  return sha256Hex(`${PEPPER}:${getSalt()}:${pw}`);
}

export function hasOverridePassword() {
  return !!localStorage.getItem(LS_HASH);
}

// Timestamp (ms) this device stays authorized until, or null if expired/never.
export function authExpiresAt() {
  const v = Number(localStorage.getItem(LS_UNTIL) || 0);
  return v > Date.now() ? v : null;
}

// True when a password exists AND this device has a live 24h session.
export function isDeviceAuthorized() {
  return hasOverridePassword() && authExpiresAt() !== null;
}

export async function verifyPassword(pw) {
  const stored = localStorage.getItem(LS_HASH);
  if (!stored) return false;
  return (await hashPw((pw || '').trim())) === stored;
}

// Verify the password and (re)start this device's 24h authorized window.
export async function authorizeDevice(pw) {
  if (!(await verifyPassword(pw))) return false;
  localStorage.setItem(LS_UNTIL, String(Date.now() + AUTH_WINDOW_MS));
  emitChange();
  return true;
}

// Set the override password (first-time setup). Authorizes this device too.
export async function setOverridePassword(pw) {
  const p = (pw || '').trim();
  if (p.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  localStorage.setItem(LS_HASH, await hashPw(p));
  localStorage.setItem(LS_UNTIL, String(Date.now() + AUTH_WINDOW_MS));
  emitChange();
}

// Change the password — requires the current one if one is already set.
export async function changeOverridePassword(currentPw, newPw) {
  if (hasOverridePassword() && !(await verifyPassword(currentPw))) {
    throw new Error('Current password is incorrect.');
  }
  await setOverridePassword(newPw);
}

// Remove the password entirely (requires the current one).
export async function clearOverridePassword(currentPw) {
  if (hasOverridePassword() && !(await verifyPassword(currentPw))) {
    throw new Error('Current password is incorrect.');
  }
  localStorage.removeItem(LS_HASH);
  localStorage.removeItem(LS_UNTIL);
  emitChange();
}

// End this device's session now (next sensitive action re-prompts).
export function lockDevice() {
  localStorage.removeItem(LS_UNTIL);
  emitChange();
}
