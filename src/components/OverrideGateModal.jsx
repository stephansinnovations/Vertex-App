import React, { useState } from 'react';
import { ShieldCheck, Lock } from 'lucide-react';
import {
  hasOverridePassword, authorizeDevice, setOverridePassword, MIN_PASSWORD_LENGTH,
} from '@/api/overrideAuth';

// The gate Jarvis shows when a sensitive action/build needs the override password.
// Two modes: first-time setup (no password yet → create one) and unlock (enter the
// existing one). Either way, success authorizes this device for 24 hours.
export default function OverrideGateModal({ reason, onResolved }) {
  const needsSetup = !hasOverridePassword();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    setBusy(true);
    try {
      if (needsSetup) {
        if (pw.trim().length < MIN_PASSWORD_LENGTH) { setErr(`At least ${MIN_PASSWORD_LENGTH} characters.`); setBusy(false); return; }
        if (pw !== confirm) { setErr('Passwords don’t match.'); setBusy(false); return; }
        await setOverridePassword(pw); // also authorizes this device
        onResolved(true);
        return;
      }
      const ok = await authorizeDevice(pw);
      if (!ok) { setErr('Incorrect password.'); setBusy(false); return; }
      onResolved(true);
    } catch (e) {
      setErr(e?.message || 'Something went wrong.');
      setBusy(false);
    }
  };

  const canSubmit = needsSetup ? (pw && confirm) : !!pw;

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md rounded-2xl border border-sky-400/30 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center gap-2 text-sky-300">
          {needsSetup ? <ShieldCheck className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          <p className="font-semibold text-sm">
            {needsSetup ? 'Set your override password' : 'Override password required'}
          </p>
        </div>

        <p className="text-xs text-white/60 leading-relaxed">
          {needsSetup
            ? 'Create a password to authorize builds and sensitive actions. Entering it unlocks this device for 24 hours.'
            : `Enter your override password to ${reason || 'authorize this action'}. This device stays unlocked for 24 hours.`}
        </p>

        <input
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          type="password"
          autoFocus
          placeholder={needsSetup ? 'New override password' : 'Override password'}
          onKeyDown={(e) => { if (e.key === 'Enter' && !needsSetup) submit(); }}
          className="w-full bg-black/40 border border-white/15 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-sky-400"
        />
        {needsSetup && (
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            type="password"
            placeholder="Confirm password"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            className="w-full bg-black/40 border border-white/15 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-sky-400"
          />
        )}

        {err && <p className="text-xs text-red-400">{err}</p>}

        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={!canSubmit || busy}
            className="flex-1 bg-sky-500 text-white font-semibold py-2.5 rounded-xl disabled:opacity-40"
          >
            {needsSetup ? 'Set & unlock' : 'Unlock'}
          </button>
          <button
            onClick={() => onResolved(false)}
            className="px-5 py-2.5 rounded-xl border border-white/15 text-white/80"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
