import { NextPageContext } from 'next';

interface ErrorProps {
  statusCode: number | undefined;
  message: string;
}

function ErrorPage({ statusCode, message }: ErrorProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="card p-8 max-w-lg w-full text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          {statusCode ? `Error ${statusCode}` : 'Client Error'}
        </h1>
        <p className="text-gray-600 mb-4">{message}</p>
        <div className="bg-gray-100 rounded-lg p-3 text-left mb-4">
          <p className="text-xs text-gray-500 font-mono break-all">{message}</p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="btn btn-primary px-6 py-2"
        >
          Reload Page
        </button>
      </div>
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext): ErrorProps => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  const message = err?.message || (statusCode === 404 ? 'Page not found' : 'An unexpected error occurred');
  return { statusCode, message };
};

export default ErrorPage;
