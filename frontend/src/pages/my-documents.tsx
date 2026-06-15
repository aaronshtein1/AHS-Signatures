import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { userDocs, UserDocument } from '@/lib/api';

function MyDocumentsContent() {
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const docs = await userDocs.list();
      setDocuments(docs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async (doc: UserDocument) => {
    try {
      const { signUrl } = await userDocs.getSignUrl(doc.id);
      router.push(signUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get signing URL');
    }
  };

  const pendingDocs = documents.filter(d => d.canSign);
  const signedDocs = documents.filter(d => d.status === 'signed');
  const waitingDocs = documents.filter(d => !d.canSign && d.status !== 'signed');

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>My Documents - AHS Signatures</title>
      </Head>
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">My Documents</h1>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {documents.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No documents</h3>
            <p className="mt-1 text-sm text-gray-500">
              You don&apos;t have any documents assigned for signature yet.
            </p>
          </div>
        ) : (
          <>
            {/* Action Required - Pending Signatures */}
            {pendingDocs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex h-3 w-3 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500"></span>
                  </span>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Action Required ({pendingDocs.length})
                  </h2>
                </div>
                <div className="space-y-3">
                  {pendingDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="bg-white border-l-4 border-orange-500 rounded-lg shadow-sm p-4 hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-gray-900 truncate">
                            {doc.packet.name}
                          </h3>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {doc.packet.fileName} &middot; Role: {doc.roleName}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            Received {new Date(doc.packet.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={() => handleSign(doc)}
                          className="ml-4 px-5 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors flex-shrink-0"
                        >
                          Sign Now
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Waiting for Others */}
            {waitingDocs.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-3">
                  Waiting for Others ({waitingDocs.length})
                </h2>
                <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                  {waitingDocs.map((doc, i) => (
                    <div
                      key={doc.id}
                      className={`p-4 flex items-center justify-between ${i > 0 ? 'border-t border-gray-100' : ''}`}
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-700">{doc.packet.name}</p>
                        <p className="text-xs text-gray-400">Role: {doc.roleName}</p>
                      </div>
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                        Waiting
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Completed */}
            {signedDocs.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-3">
                  Signed ({signedDocs.length})
                </h2>
                <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                  {signedDocs.map((doc, i) => (
                    <div
                      key={doc.id}
                      className={`p-4 flex items-center justify-between ${i > 0 ? 'border-t border-gray-100' : ''}`}
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-700">{doc.packet.name}</p>
                        <p className="text-xs text-gray-400">
                          Signed {doc.signedAt ? new Date(doc.signedAt).toLocaleDateString() : ''}
                        </p>
                      </div>
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">
                        Signed
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default function MyDocumentsPage() {
  return (
    <ProtectedRoute>
      <Layout>
        <MyDocumentsContent />
      </Layout>
    </ProtectedRoute>
  );
}
