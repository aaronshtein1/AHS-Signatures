import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import SignaturePad from '@/components/SignaturePad';
import StatusBadge from '@/components/StatusBadge';
import { signing, SigningSession, SigningConfirmation, Placeholder } from '@/lib/api';

// Client-only PDF viewer (react-pdf needs browser APIs)
const PdfFieldViewer = dynamic(() => import('@/components/PdfFieldViewer'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
    </div>
  ),
});

const ATTESTATION_TEXT = `ELECTRONIC SIGNATURE DISCLOSURE AND CONSENT

By signing this document electronically, I acknowledge and agree to the following:

1. IDENTITY CONFIRMATION: I confirm that I am the individual named in this signing request and that no other person is signing on my behalf.

2. INTENT TO SIGN: I understand that my electronic signature on this document carries the same legal weight and effect as a handwritten signature.

3. ATTESTATION: I attest, under penalty of perjury, that the information I have provided or reviewed in connection with this document is true and correct to the best of my knowledge.

4. DOCUMENT REVIEW: I have reviewed the document presented to me and understand the contents to which I am affixing my signature.

5. RECORD OF TRANSACTION: I understand that a record of this transaction — including my name, email address, IP address, browser information, and the date and time of signing — will be created and preserved as verification of my identity and intent to sign.

6. PRINTED CONFIRMATION: I understand that I may request a printed copy of this transaction confirmation at any time.

By proceeding, I acknowledge that I have read and understand this disclosure.`;

const STEP_LABELS = ['Attestation', 'Signature', 'Review'];

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

  // I-9 compliance state
  const [signingStep, setSigningStep] = useState(0); // 0=Attestation, 1=Signature, 2=Review
  const [attestationAcknowledged, setAttestationAcknowledged] = useState(false);
  const [attestationScrolled, setAttestationScrolled] = useState(false);
  const attestationRef = useRef<HTMLDivElement>(null);

  // Signature modal
  const [sigModalOpen, setSigModalOpen] = useState(false);

  // PDF data
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);

  // Confirmation receipt
  const [confirmation, setConfirmation] = useState<SigningConfirmation | null>(null);

  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = sigModalOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sigModalOpen]);

  useEffect(() => {
    if (token && typeof token === 'string') {
      loadSession(token);
      loadPdf(token);
    }
  }, [token]);

  const loadSession = async (signingToken: string) => {
    try {
      setLoading(true);
      const data = await signing.getSession(signingToken);
      setSession(data);
      setTypedName(data.recipient.name);

      const initial: Record<string, string> = {};
      data.placeholders.filter((p: Placeholder) => p.type === 'TEXT').forEach((p: Placeholder) => {
        if (p.fieldName) initial[p.fieldName] = '';
      });
      data.placeholders.filter((p: Placeholder) => p.type === 'DATE').forEach((p: Placeholder, idx: number) => {
        const key = p.fieldName || `date_${idx}`;
        initial[key] = new Date().toLocaleDateString('en-US');
      });
      setTextFields(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signing session');
    } finally {
      setLoading(false);
    }
  };

  const loadPdf = async (signingToken: string) => {
    try {
      const url = signing.getPdfUrl(signingToken);
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed to fetch PDF (${response.status})`);
      const data = await response.arrayBuffer();
      setPdfData(data);
    } catch (err) {
      console.error('PDF load error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load PDF');
    }
  };

  const handleSignatureChange = (data: string | null, type: 'drawn' | 'typed') => {
    setSignatureData(data);
    setSignatureType(type);
  };

  const handleTextFieldChange = (key: string, value: string) => {
    setTextFields((prev) => ({ ...prev, [key]: value }));
  };

  // Track attestation scroll position
  const handleAttestationScroll = () => {
    if (attestationRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = attestationRef.current;
      if (scrollTop + clientHeight >= scrollHeight - 10) {
        setAttestationScrolled(true);
      }
    }
  };

  const openSigning = () => {
    setSigningStep(0);
    setError(null);
    setSigModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!token || typeof token !== 'string') return;
    if (!signatureData) { setError('Please provide your signature'); return; }
    if (!typedName.trim()) { setError('Please enter your full name'); return; }
    if (!confirmed) { setError('Please confirm you are the intended signer'); return; }
    if (!attestationAcknowledged) { setError('Please acknowledge the attestation'); return; }

    try {
      setSubmitting(true);
      setError(null);
      const result = await signing.submit(token, {
        signatureData,
        signatureType,
        typedName: typedName.trim(),
        textFields: Object.keys(textFields).length > 0 ? textFields : undefined,
        confirmed,
        attestationAcknowledged,
        attestationText: ATTESTATION_TEXT,
      });
      setSubmitted(true);
      setCompleted(result.completed);
      setSigModalOpen(false);

      // Fetch confirmation receipt
      try {
        const conf = await signing.getConfirmation(token);
        setConfirmation(conf);
      } catch {
        // Non-critical — confirmation is supplementary
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit signature');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrintConfirmation = () => {
    window.print();
  };

  // --- Loading ---
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading document...</p>
        </div>
      </div>
    );
  }

  // --- Error (no session) ---
  if (error && !session) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="card p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Unable to Load Document</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  // --- Success ---
  if (submitted) {
    return (
      <>
        <Head>
          <title>Signed - {session?.packet.name}</title>
        </Head>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="card p-8 max-w-lg w-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
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
            </div>

            {/* Transaction Confirmation (I-9 Requirement #5) */}
            {confirmation && (
              <div className="mt-6 border-t border-gray-200 pt-6 print-confirmation">
                <h2 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wide">
                  Transaction Confirmation
                </h2>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Confirmation ID</span>
                    <span className="text-gray-900 font-mono text-xs">{confirmation.confirmationId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Signer</span>
                    <span className="text-gray-900">{confirmation.signer.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Email</span>
                    <span className="text-gray-900">{confirmation.signer.email}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Document</span>
                    <span className="text-gray-900">{confirmation.document.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Signature Type</span>
                    <span className="text-gray-900 capitalize">{confirmation.signature.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Signed At</span>
                    <span className="text-gray-900">
                      {new Date(confirmation.signature.signedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Attestation</span>
                    <span className="text-green-600 font-medium">Acknowledged</span>
                  </div>
                </div>

                <div className="mt-4 flex gap-2 justify-center no-print">
                  <button
                    onClick={handlePrintConfirmation}
                    className="btn btn-secondary px-4 py-2 text-sm flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Print Confirmation
                  </button>
                </div>
              </div>
            )}

            <p className="text-sm text-gray-500 mt-6 text-center no-print">You can close this window.</p>
          </div>
        </div>
      </>
    );
  }

  if (!session) return null;

  // Compute step completion
  const stepComplete = [
    attestationAcknowledged,
    !!signatureData && !!typedName.trim(),
    confirmed,
  ];

  // Determine what the bottom bar button should do
  const getBottomAction = () => {
    if (!attestationAcknowledged) {
      return { label: 'Begin Signing', onClick: openSigning };
    }
    if (!signatureData) {
      return { label: 'Add Signature', onClick: () => { setSigningStep(1); setSigModalOpen(true); } };
    }
    if (!confirmed) {
      return { label: 'Review & Submit', onClick: () => { setSigningStep(2); setSigModalOpen(true); } };
    }
    return { label: submitting ? 'Submitting...' : 'Submit Signature', onClick: handleSubmit };
  };

  const bottomAction = getBottomAction();

  return (
    <>
      <Head>
        <title>Sign Document - {session.packet.name}</title>
      </Head>

      <div className="min-h-screen bg-gray-200 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 flex-shrink-0 z-30">
          <div className="px-4 py-2 flex items-center justify-between">
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-gray-900 truncate">
                {session.packet.name}
              </h1>
              <p className="text-xs text-gray-500 truncate">
                Signing as: {session.recipient.name} ({session.recipient.email})
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 ml-4">
              <div className="hidden sm:flex items-center gap-1">
                {session.signers.map((signer) => (
                  <div
                    key={signer.order}
                    title={`${signer.name} - ${signer.status}`}
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      signer.status === 'signed'
                        ? 'bg-green-100 text-green-700'
                        : signer.isCurrentUser
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {signer.status === 'signed' ? '\u2713' : signer.order}
                  </div>
                ))}
              </div>
              <StatusBadge status={session.recipient.roleName} />
            </div>
          </div>
        </header>

        {/* Scrollable PDF with overlaid fields */}
        <div className="flex-1 overflow-y-auto px-4 py-6" style={{ paddingBottom: 90 }}>
          <div className="mx-auto" style={{ maxWidth: 900 }}>
            <PdfFieldViewer
              pdfData={pdfData}
              placeholders={session.placeholders}
              signatureData={signatureData}
              textFields={textFields}
              onTextFieldChange={handleTextFieldChange}
              onSignatureClick={() => {
                setSigningStep(attestationAcknowledged ? 1 : 0);
                setSigModalOpen(true);
              }}
            />
          </div>
        </div>

        {/* Bottom action bar with 3-step indicators */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-40">
          <div className="px-4 py-3 flex items-center justify-between max-w-4xl mx-auto">
            <div className="flex items-center gap-3">
              {STEP_LABELS.map((label, i) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${
                    stepComplete[i] ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {stepComplete[i] ? '\u2713' : i + 1}
                  </span>
                  <span className="text-xs text-gray-500 hidden sm:inline">{label}</span>
                </div>
              ))}
            </div>

            <button
              onClick={bottomAction.onClick}
              disabled={submitting}
              className="btn btn-primary px-5 py-2 text-sm"
            >
              {bottomAction.label}
            </button>
          </div>
        </div>

        {/* 3-Step Signing Modal */}
        {sigModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
              {/* Modal header with step tabs */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0">
                <div className="flex items-center gap-3">
                  {STEP_LABELS.map((label, i) => (
                    <button
                      key={label}
                      onClick={() => {
                        // Only allow navigating to completed steps or current step
                        if (i === 0 || (i === 1 && attestationAcknowledged) || (i === 2 && attestationAcknowledged && signatureData)) {
                          setSigningStep(i);
                        }
                      }}
                      className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
                        signingStep === i
                          ? 'text-blue-600'
                          : stepComplete[i]
                          ? 'text-green-600 cursor-pointer'
                          : 'text-gray-300 cursor-not-allowed'
                      }`}
                    >
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                        signingStep === i
                          ? 'bg-blue-100 text-blue-600'
                          : stepComplete[i]
                          ? 'bg-green-100 text-green-600'
                          : 'bg-gray-100 text-gray-400'
                      }`}>
                        {stepComplete[i] ? '\u2713' : i + 1}
                      </span>
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setSigModalOpen(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Step content */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {/* Step 0: Attestation */}
                {signingStep === 0 && (
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 mb-1">Read & Acknowledge</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Please read the following disclosure carefully. You must scroll to the bottom before acknowledging.
                    </p>

                    <div
                      ref={attestationRef}
                      onScroll={handleAttestationScroll}
                      className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-56 overflow-y-auto text-sm text-gray-700 whitespace-pre-wrap leading-relaxed"
                    >
                      {ATTESTATION_TEXT}
                    </div>

                    {!attestationScrolled && (
                      <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                        Scroll down to read the full disclosure
                      </p>
                    )}

                    <label className={`flex items-start gap-3 cursor-pointer p-3 rounded-lg border mt-4 transition-colors ${
                      attestationScrolled
                        ? 'border-gray-200 hover:bg-gray-50'
                        : 'border-gray-100 opacity-50 cursor-not-allowed'
                    }`}>
                      <input
                        type="checkbox"
                        checked={attestationAcknowledged}
                        onChange={(e) => {
                          if (attestationScrolled) setAttestationAcknowledged(e.target.checked);
                        }}
                        disabled={!attestationScrolled}
                        className="mt-0.5 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">
                        I have read and understand the above disclosure and confirm that the information
                        I provide is true and correct.
                      </span>
                    </label>
                  </div>
                )}

                {/* Step 1: Signature */}
                {signingStep === 1 && (
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 mb-1">Your Signature</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Draw or type your signature below.
                    </p>
                    <SignaturePad
                      onSignatureChange={handleSignatureChange}
                      typedName={typedName}
                      onTypedNameChange={setTypedName}
                    />
                  </div>
                )}

                {/* Step 2: Review & Submit */}
                {signingStep === 2 && (
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 mb-1">Review & Submit</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Please review the details below before signing.
                    </p>

                    {/* Summary card */}
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Name</span>
                        <span className="text-gray-900 font-medium">{typedName}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Email</span>
                        <span className="text-gray-900">{session.recipient.email}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Document</span>
                        <span className="text-gray-900">{session.packet.name}</span>
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-gray-500">Signature</span>
                        {signatureType === 'drawn' && signatureData ? (
                          <img src={signatureData} alt="Your signature" className="h-10 border border-gray-200 rounded bg-white px-2" />
                        ) : (
                          <span className="text-gray-900 italic" style={{ fontFamily: '"Dancing Script", cursive', fontSize: '1.1rem' }}>
                            {typedName}
                          </span>
                        )}
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Attestation</span>
                        <span className="text-green-600 font-medium">Acknowledged</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Date & Time</span>
                        <span className="text-gray-900">{new Date().toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Identity notice */}
                    <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <p className="text-xs text-blue-800">
                        <strong>Identity Verification:</strong> Your name, email, IP address, browser information,
                        and secure access token will be recorded as part of this transaction record.
                      </p>
                    </div>

                    {/* Confirmation checkbox */}
                    <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors mt-4">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                        className="mt-0.5 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">
                        I confirm that I am <strong>{session.recipient.name}</strong> and
                        I am the intended signer of this document.
                      </span>
                    </label>

                    {error && (
                      <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
                        <p className="text-red-700 text-sm">{error}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Modal footer */}
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 flex-shrink-0">
                {signingStep === 0 ? (
                  <button
                    onClick={() => setSigModalOpen(false)}
                    className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
                  >
                    Close
                  </button>
                ) : (
                  <button
                    onClick={() => setSigningStep(signingStep - 1)}
                    className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
                  >
                    Back
                  </button>
                )}

                {signingStep === 0 && (
                  <button
                    onClick={() => setSigningStep(1)}
                    disabled={!attestationAcknowledged}
                    className="btn btn-primary px-5 py-2 text-sm"
                  >
                    Continue
                  </button>
                )}

                {signingStep === 1 && (
                  <button
                    onClick={() => setSigningStep(2)}
                    disabled={!signatureData || !typedName.trim()}
                    className="btn btn-primary px-5 py-2 text-sm"
                  >
                    Review
                  </button>
                )}

                {signingStep === 2 && (
                  <button
                    onClick={handleSubmit}
                    disabled={!confirmed || submitting}
                    className="btn btn-primary px-5 py-2 text-sm"
                  >
                    {submitting ? 'Submitting...' : 'Sign Document'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
