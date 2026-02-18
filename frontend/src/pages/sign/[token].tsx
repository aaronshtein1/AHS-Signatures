import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import SignaturePad from '@/components/SignaturePad';
import StatusBadge from '@/components/StatusBadge';
import { signing, SigningSession, Placeholder } from '@/lib/api';

export default function SigningPage() {
  const router = useRouter();
  const { token } = router.query;

  const [session, setSession] = useState<SigningSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Form state
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signatureType, setSignatureType] = useState<'drawn' | 'typed'>('drawn');
  const [typedName, setTypedName] = useState('');
  const [textFields, setTextFields] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (token && typeof token === 'string') {
      loadSession(token);
    }
  }, [token]);

  const loadSession = async (signingToken: string) => {
    try {
      setLoading(true);
      const data = await signing.getSession(signingToken);
      setSession(data);

      // Pre-fill name
      setTypedName(data.recipient.name);

      // Initialize text fields (including DATE fields which get fieldName like 'Dte1')
      const textPlaceholders = data.placeholders.filter(
        (p: Placeholder) => p.type === 'TEXT'
      );
      const datePlaceholders = data.placeholders.filter(
        (p: Placeholder) => p.type === 'DATE'
      );
      const initialTextFields: Record<string, string> = {};
      textPlaceholders.forEach((p: Placeholder) => {
        if (p.fieldName) {
          initialTextFields[p.fieldName] = '';
        }
      });
      // Also add date fields - use fieldName or a generated key
      datePlaceholders.forEach((p: Placeholder, idx: number) => {
        const fieldKey = p.fieldName || `date_${idx}`;
        initialTextFields[fieldKey] = new Date().toLocaleDateString('en-US');
      });
      setTextFields(initialTextFields);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signing session');
    } finally {
      setLoading(false);
    }
  };

  const handleSignatureChange = (data: string | null, type: 'drawn' | 'typed') => {
    setSignatureData(data);
    setSignatureType(type);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token || typeof token !== 'string') return;

    if (!signatureData) {
      setError('Please provide your signature');
      return;
    }

    if (!typedName.trim()) {
      setError('Please enter your full name');
      return;
    }

    if (!confirmed) {
      setError('Please confirm you are the intended signer');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const result = await signing.submit(token, {
        signatureData,
        signatureType,
        typedName: typedName.trim(),
        textFields: Object.keys(textFields).length > 0 ? textFields : undefined,
        confirmed,
      });

      setSubmitted(true);
      setCompleted(result.completed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit signature');
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading document...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !session) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="card p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Unable to Load Document</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  // Success state
  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="card p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            {completed ? 'Document Completed!' : 'Signature Submitted!'}
          </h1>
          <p className="text-gray-600">
            {completed
              ? 'All signatures have been collected. You will receive the signed document via email.'
              : 'Your signature has been recorded. The document will be sent to the next signer.'}
          </p>
          <p className="text-sm text-gray-500 mt-4">You can close this window.</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  const textPlaceholders = session.placeholders.filter((p) => p.type === 'TEXT');
  const datePlaceholders = session.placeholders.filter((p) => p.type === 'DATE');

  return (
    <>
      <Head>
        <title>Sign Document - {session.packet.name}</title>
      </Head>

      <div className="min-h-screen bg-gray-100">
        {/* Header */}
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-4xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold text-gray-900">
                  {session.packet.name}
                </h1>
                <p className="text-sm text-gray-500">
                  Signing as: {session.recipient.name} ({session.recipient.email})
                </p>
              </div>
              <StatusBadge status={session.recipient.roleName} />
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* PDF Preview */}
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-gray-200 bg-gray-50">
                <h2 className="font-medium text-gray-900">Document Preview</h2>
              </div>
              <div className="bg-gray-200">
                <iframe
                  src={signing.getPdfUrl(token as string)}
                  className="w-full h-[600px]"
                  title="Document Preview"
                />
              </div>
            </div>

            {/* Signing Form */}
            <div className="space-y-6">
              {/* Signer progress */}
              <div className="card p-4">
                <h3 className="font-medium text-gray-900 mb-3">Signing Progress</h3>
                <div className="space-y-2">
                  {session.signers.map((signer) => (
                    <div
                      key={signer.order}
                      className={`flex items-center gap-3 p-2 rounded ${
                        signer.isCurrentUser ? 'bg-blue-50' : ''
                      }`}
                    >
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                          signer.status === 'signed'
                            ? 'bg-green-100 text-green-700'
                            : signer.isCurrentUser
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {signer.status === 'signed' ? '✓' : signer.order}
                      </span>
                      <span
                        className={`flex-1 ${
                          signer.isCurrentUser ? 'font-medium' : ''
                        }`}
                      >
                        {signer.name}
                        {signer.isCurrentUser && ' (You)'}
                      </span>
                      <StatusBadge status={signer.status} size="sm" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Signature form */}
              <form onSubmit={handleSubmit} className="card p-6 space-y-6">
                <div>
                  <h3 className="font-medium text-gray-900 mb-4">Your Signature</h3>
                  <SignaturePad
                    onSignatureChange={handleSignatureChange}
                    typedName={typedName}
                    onTypedNameChange={setTypedName}
                  />
                </div>

                {/* Text fields and Date fields */}
                {(textPlaceholders.length > 0 || datePlaceholders.length > 0) && (
                  <div>
                    <h3 className="font-medium text-gray-900 mb-4">
                      Required Information
                    </h3>
                    <div className="space-y-4">
                      {/* Date fields */}
                      {datePlaceholders.map((placeholder, idx) => {
                        const fieldKey = placeholder.fieldName || `date_${idx}`;
                        return (
                          <div key={fieldKey}>
                            <label className="label">
                              Date
                            </label>
                            <input
                              type="date"
                              value={textFields[fieldKey] ? new Date(textFields[fieldKey]).toISOString().split('T')[0] : ''}
                              onChange={(e) =>
                                setTextFields({
                                  ...textFields,
                                  [fieldKey]: e.target.value ? new Date(e.target.value).toLocaleDateString('en-US') : '',
                                })
                              }
                              className="input"
                            />
                          </div>
                        );
                      })}
                      {/* Text fields */}
                      {textPlaceholders.map((placeholder) => (
                        <div key={placeholder.fieldName}>
                          <label className="label capitalize">
                            {placeholder.fieldName?.replace(/_/g, ' ').replace(/#/g, ' #')}
                          </label>
                          <input
                            type="text"
                            value={textFields[placeholder.fieldName!] || ''}
                            onChange={(e) =>
                              setTextFields({
                                ...textFields,
                                [placeholder.fieldName!]: e.target.value,
                              })
                            }
                            className="input"
                            placeholder={`Enter ${placeholder.fieldName?.replace(/_/g, ' ')}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Confirmation */}
                <div className="border-t border-gray-200 pt-6">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">
                      I confirm that I am <strong>{session.recipient.name}</strong> and
                      I am the intended signer of this document. I understand this
                      signature is for internal acknowledgment purposes.
                    </span>
                  </label>
                </div>

                {/* Error */}
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-red-700 text-sm">{error}</p>
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={submitting || !signatureData || !confirmed}
                  className="btn btn-primary w-full py-3 text-lg"
                >
                  {submitting ? 'Submitting...' : 'Sign Document'}
                </button>

                <p className="text-xs text-gray-500 text-center">
                  This signing system is for internal acknowledgments only and does
                  not provide a formal legal audit trail.
                </p>
              </form>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
