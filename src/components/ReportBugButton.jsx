import React, { useState } from 'react';
import { Bug, Check } from 'lucide-react';
import { reportBug } from '@/api/bugReports';

// The "Report Bug" button shown wherever an error surfaces. Saves the given bug
// record (Supabase + local) and reflects progress: Report Bug → Reporting… → done.
export default function ReportBugButton({ bug, className = '' }) {
  const [state, setState] = useState('idle'); // idle | saving | done

  const submit = async () => {
    if (state !== 'idle') return;
    setState('saving');
    await reportBug(bug);
    setState('done');
  };

  return (
    <button
      onClick={submit}
      disabled={state !== 'idle'}
      className={className || 'inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-70 text-white text-sm font-semibold px-4 py-2.5 rounded-full transition-colors'}
    >
      {state === 'done'
        ? <><Check className="w-4 h-4" /> Bug reported</>
        : state === 'saving'
          ? 'Reporting…'
          : <><Bug className="w-4 h-4" /> Report Bug</>}
    </button>
  );
}
