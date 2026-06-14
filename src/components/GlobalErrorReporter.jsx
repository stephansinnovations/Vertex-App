import React, { useEffect, useState } from 'react';
import { Bug, X } from 'lucide-react';
import { buildBug } from '@/api/bugReports';
import ReportBugButton from '@/components/ReportBugButton';

// Catches errors that an ErrorBoundary can't — uncaught window errors (e.g.
// "Unexpected token", syntax/runtime errors) and unhandled promise rejections —
// and surfaces a dismissible toast with a "Report Bug" button.
export default function GlobalErrorReporter() {
  const [bug, setBug] = useState(null);

  useEffect(() => {
    let last = 0;
    const surface = (errOrMsg, source) => {
      const now = Date.now();
      if (now - last < 800) return; // throttle error bursts into one toast
      last = now;
      setBug(buildBug(errOrMsg, source));
    };

    const onError = (e) => {
      const msg = e?.message || '';
      // Ignore well-known noise that isn't actionable.
      if (/ResizeObserver loop|^Script error\.?$/i.test(msg)) return;
      surface(e?.error || msg || 'Unknown error', 'window');
    };
    const onRejection = (e) => {
      const r = e?.reason;
      surface(r instanceof Error ? r : (r?.message || String(r) || 'Unhandled promise rejection'), 'promise');
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  if (!bug) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] w-[calc(100%-2rem)] max-w-md">
      <div className="bg-white border border-red-200 rounded-2xl shadow-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <Bug className="w-5 h-5 text-red-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-gray-900 font-semibold text-sm">Something went wrong</p>
            <p className="text-gray-500 text-xs mt-0.5 line-clamp-2 break-words">{bug.message}</p>
            <div className="mt-3">
              <ReportBugButton bug={bug} />
            </div>
          </div>
          <button onClick={() => setBug(null)} className="text-gray-400 hover:text-gray-700 flex-shrink-0" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
