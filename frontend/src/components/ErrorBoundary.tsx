import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div>
          {/* Always show error details for debugging */}
          <div style={{
            background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
            padding: '12px 16px', margin: '8px 0', fontFamily: 'monospace', fontSize: 13,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            <strong style={{ color: '#dc2626' }}>Error:</strong>{' '}
            <span style={{ color: '#1f2937' }}>
              {this.state.error?.message || 'Unknown error'}
            </span>
            {this.state.error?.stack && (
              <details style={{ marginTop: 8, fontSize: 11, color: '#6b7280' }}>
                <summary style={{ cursor: 'pointer' }}>Stack trace</summary>
                <pre style={{ marginTop: 4, overflow: 'auto' }}>{this.state.error.stack}</pre>
              </details>
            )}
          </div>
          {this.props.fallback || (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
              <div className="card p-8 max-w-lg w-full text-center">
                <h1 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h1>
                <button
                  onClick={() => {
                    this.setState({ hasError: false, error: null });
                    window.location.reload();
                  }}
                  className="btn btn-primary px-6 py-2"
                >
                  Reload Page
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
