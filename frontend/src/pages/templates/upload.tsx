import { useState, useRef } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { templates } from '@/lib/api';

export default function UploadTemplatePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file');
      return;
    }

    try {
      setUploading(true);
      setError(null);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', name);
      if (description) {
        formData.append('description', description);
      }

      const result = await templates.upload(formData);
      router.push(`/templates?uploaded=${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Upload Template</h1>
          <p className="text-gray-600">
            Upload a PDF with placeholder tags for signatures
          </p>
        </div>

        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* File upload area */}
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

            {/* Template name */}
            <div>
              <label className="label">Template Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Employee Acknowledgment Form"
                className="input"
                required
              />
            </div>

            {/* Description */}
            <div>
              <label className="label">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this template..."
                className="input"
                rows={3}
              />
            </div>

            {/* Placeholder info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-900 mb-2">
                Placeholder Tags
              </h3>
              <p className="text-sm text-blue-800 mb-2">
                Add these tags to your PDF where signatures should appear:
              </p>
              <ul className="text-sm text-blue-700 space-y-1 font-mono">
                <li>[[SIGNATURE:roleName]] - Signature field</li>
                <li>[[DATE:roleName]] - Date field</li>
                <li>[[TEXT:fieldName]] - Text input field</li>
              </ul>
              <p className="text-sm text-blue-600 mt-2">
                Example roles: employee, manager, contractor, witness
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-700">{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-4">
              <button
                type="submit"
                disabled={uploading || !file}
                className="btn btn-primary flex-1"
              >
                {uploading ? 'Uploading...' : 'Upload Template'}
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
      </div>
    </Layout>
  );
}
