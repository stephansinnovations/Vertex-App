import React from 'react';
import { Bug } from 'lucide-react';
import { buildBug } from '@/api/bugReports';
import ReportBugButton from '@/components/ReportBugButton';

// Catches render/runtime errors anywhere in the React tree and shows a fallback
// with a "Report Bug" button instead of a blank white screen. (Global window
// errors + promise rejections are handled separately by GlobalErrorReporter.)
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error('App error boundary caught:', error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const bug = buildBug(error, 'render');
    if (info?.componentStack) {
      bug.stack = `${bug.stack}\n\nComponent stack:${info.componentStack}`.slice(0, 4000);
    }

    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-100 flex items-center justify-center">
            <Bug className="w-6 h-6 text-red-600" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Something went wrong</h2>
          <p className="text-gray-500 text-sm mt-1">An unexpected error crashed this screen.</p>
          <pre className="mt-3 text-left text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-3 max-h-32 overflow-auto whitespace-pre-wrap break-words">
            {error.message || String(error)}
          </pre>
          <div className="flex gap-2 mt-5">
            <ReportBugButton bug={bug}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-70 text-white text-sm font-semibold py-3 rounded-full transition-colors" />
            <button onClick={() => window.location.reload()}
              className="flex-1 border border-gray-300 text-gray-700 text-sm font-semibold py-3 rounded-full hover:bg-gray-50 transition-colors">
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
