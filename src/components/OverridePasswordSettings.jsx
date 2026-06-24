import React, { useState, useEffect } from 'react';
import { Check, X, Lock, Unlock } from 'lucide-react';
import {
  hasOverridePassword, isDeviceAuthorized, authExpiresAt,
  setOverridePassword, changeOverridePassword, lockDevice, MIN_PASSWORD_LENGTH,
} from '@/api/overrideAuth';

// Settings card: set/change the override password and see/manage this device's
// 24h authorized session. Lives in the Settings page's Security section.
export default function OverridePasswordSettings() {
  const [hasPw, setHasPw] = useState(hasOverridePassword());
  const [authorized, setAuthorized] = useState(isDeviceAuthorized());
  const [until, setUntil] = useState(authExpiresAt());

  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const refresh = () => {
    setHasPw(hasOverridePassword());
    setAuthorized(isDeviceAuthorized());
    setUntil(authExpiresAt());
  };

  useEffect(() => {
    window.addEventListener('override-auth-change', refresh);
    return () => window.removeEventListener('override-auth-change', refresh);
  }, []);

  const remaining = () => {
    if (!until) return null;
    const ms = until - Date.now();
    if (ms <= 0) return null;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const startEdit = () => {
    setErr(''); setOk('');
    setCurrent(''); setNext(''); setConfirm('');
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setCurrent(''); setNext(''); setConfirm(''); setErr('');
  };

  const save = async () => {
    setErr(''); setOk('');
    if (next.trim().length < MIN_PASSWORD_LENGTH) { setErr(`At least ${MIN_PASSWORD_LENGTH} characters.`); return; }
    if (next !== confirm) { setErr('Passwords don’t match.'); return; }
    try {
      if (hasPw) await changeOverridePassword(current, next);
      else await setOverridePassword(next);
      setOk(hasPw ? 'Password changed — this device is authorized for 24h.' : 'Password set — this device is authorized for 24h.');
      cancel();
      refresh();
    } catch (e) {
      setErr(e?.message || 'Failed to save.');
    }
  };

  const inputCls = 'w-full bg-black border border-zinc-700 rounded px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500';

  return (
    <div
      className="w-full rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900/40"
      style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
    >
      <div className="px-6 py-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-white">Override password</span>
          {!editing && (
            <button
              onClick={startEdit}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              {hasPw ? 'Change' : 'Set'}
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-2 mt-2">
            {hasPw && (
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="Current password"
                className={inputCls}
                autoFocus
              />
            )}
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder={hasPw ? 'New password' : 'Override password'}
              className={inputCls}
              autoFocus={!hasPw}
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
              placeholder="Confirm password"
              className={inputCls}
            />
            {err && <p className="text-xs text-red-400">{err}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={save}
                className="bg-white text-black font-semibold text-sm px-4 py-2 rounded hover:bg-gray-200 transition-colors flex items-center gap-1"
              >
                <Check className="w-4 h-4" /> Save
              </button>
              <button
                onClick={cancel}
                className="bg-zinc-800 text-white text-sm px-3 py-2 rounded hover:bg-zinc-700 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : hasPw ? (
          <p className="text-gray-500 text-xs">
            ••••••••••••••••••••• <span className="text-green-400 ml-1">✓ Set</span>
          </p>
        ) : (
          <p className="text-gray-600 text-xs">
            Not set — builds and sensitive actions will prompt you to create one.
          </p>
        )}

        {ok && !editing && <p className="text-green-400 text-xs mt-2">{ok}</p>}
      </div>

      {/* Device session row */}
      {hasPw && !editing && (
        <div className="px-6 py-4 border-t border-zinc-800 flex items-center justify-between">
          {authorized ? (
            <>
              <span className="flex items-center gap-2 text-xs text-green-400">
                <Unlock className="w-3.5 h-3.5" />
                This device is authorized{remaining() ? ` · ${remaining()} left` : ''}
              </span>
              <button
                onClick={() => { lockDevice(); refresh(); }}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
              >
                <Lock className="w-3.5 h-3.5" /> Lock now
              </button>
            </>
          ) : (
            <span className="flex items-center gap-2 text-xs text-gray-500">
              <Lock className="w-3.5 h-3.5" />
              Locked — the next build will ask for the password
            </span>
          )}
        </div>
      )}
    </div>
  );
}
