import '@/styles/globals.css';
import { useEffect, useState } from 'react';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { AuthProvider } from '@/contexts/AuthContext';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function App({ Component, pageProps }: AppProps) {
  const [globalError, setGlobalError] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const msg = `[window.onerror] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`;
      console.error(msg, event.error);
      setGlobalError(msg);
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg = `[unhandledrejection] ${reason?.message || reason?.toString?.() || String(reason)}`;
      console.error(msg, reason);
      setGlobalError(msg);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <Head>
          <title>AHS Signatures</title>
          <meta name="description" content="Lightweight PDF Signing System" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/favicon.ico" />
          <link
            href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;700&family=Great+Vibes&family=Caveat:wght@400;700&family=Sacramento&family=Homemade+Apple&display=swap"
            rel="stylesheet"
          />
        </Head>
        {globalError && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
            background: '#fef2f2', borderBottom: '2px solid #dc2626',
            padding: '12px 16px', fontFamily: 'monospace', fontSize: '13px',
          }}>
            <strong style={{ color: '#dc2626' }}>Caught Error:</strong>{' '}
            <span style={{ color: '#1f2937' }}>{globalError}</span>
            <button
              onClick={() => setGlobalError(null)}
              style={{ marginLeft: 12, color: '#6b7280', cursor: 'pointer', background: 'none', border: 'none' }}
            >
              dismiss
            </button>
          </div>
        )}
        <Component {...pageProps} />
      </AuthProvider>
    </ErrorBoundary>
  );
}
