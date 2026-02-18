import { useState, useRef } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { packets } from '@/lib/api';

interface RecipientInput {
  roleName: string;
  name: string;
  email: string;
  order: number;
}

function NewPacketContent() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // File state
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [recipients, setRecipients] = useState<RecipientInput[]>([
    { roleName: 'signer', name: '', email: '', order: 1 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (selectedFile: File) => {
    if (selectedFile.type !== 'application/pdf') {
      setError('Please select a PDF file');
      return;
    }
    setFile(selectedFile);
    setError(null);
    if (!name) {
      setName(selectedFile.name.replace('.pdf', ''));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  const addRecipient = () => {
    const newOrder = recipients.length + 1;
    setRecipients([
      ...recipients,
      {
        roleName: `signer${newOrder > 1 ? newOrder : ''}`,
        name: '',
        email: '',
        order: newOrder,
      },
    ]);
  };

  const removeRecipient = (index: number) => {
    if (recipients.length <= 1) return;
    const updated = recipients.filter((_, i) => i !== index);
    // Renumber orders
    updated.forEach((r, i) => {
      r.order = i + 1;
    });
    setRecipients(updated);
  };

  const updateRecipient = (index: number, field: keyof RecipientInput, value: string | number) => {
    const updated = [...recipients];
    updated[index] = { ...updated[index], [field]: value };
    setRecipients(updated);
  };

  const moveRecipient = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= recipients.length) return;

    const updated = [...recipients];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];

    // Update order numbers
    updated.forEach((r, i) => {
      r.order = i + 1;
    });

    setRecipients(updated);
  };

  const handleSubmit = async (e: React.FormEvent, sendImmediately: boolean = false) => {
    e.preventDefault();

    if (!file) {
      setError('Please upload a PDF document');
      return;
    }

    const invalidRecipient = recipients.find((r) => !r.name || !r.email);
    if (invalidRecipient) {
      setError('Please fill in all recipient details');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmail = recipients.find((r) => !emailRegex.test(r.email));
    if (invalidEmail) {
      setError(`Invalid email address: ${invalidEmail.email}`);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // Build FormData with file and JSON fields
      const formData = new FormData();
      formData.append('file', file, file.name);
      formData.append('name', name || file.name.replace('.pdf', ''));
      formData.append('recipients', JSON.stringify(
        recipients.map((r) => ({
          roleName: r.roleName,
          name: r.name,
          email: r.email,
          order: r.order,
        }))
      ));

      const packet = await packets.create(formData);

      // Send immediately if requested
      if (sendImmediately) {
        await packets.send(packet.id);
      }

      router.push(`/packets/${packet.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create packet');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Create Signing Packet</h1>
          <p className="text-gray-600">Upload a PDF and configure recipients for signing</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Step 1: Upload PDF */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold mb-4">1. Upload Document</h2>

            <div>
              <label className="label">PDF File</label>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  dragActive
                    ? 'border-blue-500 bg-blue-50'
                    : file
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                  className="hidden"
                />
                {file ? (
                  <div>
                    <svg
                      className="mx-auto h-12 w-12 text-green-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <p className="mt-2 font-medium text-gray-900">{file.name}</p>
                    <p className="text-sm text-gray-500">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                      }}
                      className="mt-2 text-sm text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div>
                    <svg
                      className="mx-auto h-12 w-12 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                      />
                    </svg>
                    <p className="mt-2 text-gray-600">
                      Drag and drop a PDF, or click to select
                    </p>
                    <p className="text-sm text-gray-400">Max 50MB</p>
                  </div>
                )}
              </div>
            </div>

            {/* Placeholder info */}
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-900 mb-2">
                Placeholder Tags (Optional)
              </h3>
              <p className="text-sm text-blue-800 mb-2">
                Add these tags to your PDF where signatures should appear:
              </p>
              <ul className="text-sm text-blue-700 space-y-1 font-mono">
                <li>[[SIGNATURE:roleName]] - Signature field</li>
                <li>[[DATE:roleName]] - Date field</li>
                <li>[[TEXT:fieldName]] - Text input field</li>
              </ul>
            </div>
          </div>

          {/* Step 2: Configure Recipients */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold mb-4">2. Configure Recipients</h2>

            <div className="mb-4">
              <label className="label">Packet Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={file ? file.name.replace('.pdf', '') : 'e.g., Contract Agreement'}
                className="input"
              />
            </div>

            <div className="space-y-4">
              {recipients.map((recipient, index) => (
                <div
                  key={index}
                  className="p-4 border border-gray-200 rounded-lg"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-sm font-medium flex items-center justify-center">
                        {recipient.order}
                      </span>
                      <span className="font-medium text-gray-900">
                        Recipient {recipient.order}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveRecipient(index, 'up')}
                        disabled={index === 0}
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        title="Move up"
                      >
                        <span className="sr-only">Move up</span>
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveRecipient(index, 'down')}
                        disabled={index === recipients.length - 1}
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        title="Move down"
                      >
                        <span className="sr-only">Move down</span>
                        ↓
                      </button>
                      {recipients.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeRecipient(index)}
                          className="p-1 text-red-400 hover:text-red-600"
                          title="Remove recipient"
                        >
                          <span className="sr-only">Remove</span>
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Full Name</label>
                      <input
                        type="text"
                        value={recipient.name}
                        onChange={(e) => updateRecipient(index, 'name', e.target.value)}
                        placeholder="John Doe"
                        className="input"
                        required
                      />
                    </div>
                    <div>
                      <label className="label">Email Address</label>
                      <input
                        type="email"
                        value={recipient.email}
                        onChange={(e) => updateRecipient(index, 'email', e.target.value)}
                        placeholder="john@example.com"
                        className="input"
                        required
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addRecipient}
              className="mt-4 w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
            >
              + Add Another Recipient
            </button>

            <p className="mt-4 text-sm text-gray-500">
              Recipients will be notified in the order shown above (sequential signing).
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-700">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-4">
            <button
              type="button"
              onClick={(e) => handleSubmit(e as any, true)}
              disabled={submitting || !file || recipients.length === 0}
              className="btn btn-primary flex-1"
            >
              {submitting ? 'Creating...' : 'Create & Send'}
            </button>
            <button
              type="submit"
              disabled={submitting || !file || recipients.length === 0}
              className="btn btn-secondary"
            >
              Save as Draft
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}

export default function NewPacketPage() {
  return (
    <ProtectedRoute requireAdmin>
      <NewPacketContent />
    </ProtectedRoute>
  );
}
