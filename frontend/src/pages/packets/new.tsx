import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { templates, packets, Template } from '@/lib/api';

interface RecipientInput {
  roleName: string;
  name: string;
  email: string;
  order: number;
}

export default function NewPacketPage() {
  const router = useRouter();
  const { templateId: queryTemplateId } = router.query;

  const [templateList, setTemplateList] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [name, setName] = useState('');
  const [recipients, setRecipients] = useState<RecipientInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    if (queryTemplateId && typeof queryTemplateId === 'string') {
      setSelectedTemplateId(queryTemplateId);
    }
  }, [queryTemplateId]);

  useEffect(() => {
    if (selectedTemplateId) {
      const template = templateList.find((t) => t.id === selectedTemplateId);
      if (template) {
        setSelectedTemplate(template);
        initializeRecipients(template);
      }
    } else {
      setSelectedTemplate(null);
      setRecipients([]);
    }
  }, [selectedTemplateId, templateList]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const data = await templates.list();
      setTemplateList(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const initializeRecipients = (template: Template) => {
    const roles = Array.from(
      new Set(
        template.placeholders
          .filter((p) => p.type !== 'TEXT')
          .map((p) => p.role)
      )
    );

    const newRecipients = roles.map((role, index) => ({
      roleName: role,
      name: '',
      email: '',
      order: index + 1,
    }));

    setRecipients(newRecipients);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedTemplateId) {
      setError('Please select a template');
      return;
    }

    const invalidRecipient = recipients.find((r) => !r.name || !r.email);
    if (invalidRecipient) {
      setError('Please fill in all recipient details');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const packet = await packets.create({
        name: name || `${selectedTemplate?.name} - ${new Date().toLocaleDateString()}`,
        templateId: selectedTemplateId,
        recipients: recipients.map((r) => ({
          roleName: r.roleName,
          name: r.name,
          email: r.email,
          order: r.order,
        })),
      });

      router.push(`/packets/${packet.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create packet');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Create Signing Packet</h1>
          <p className="text-gray-600">Set up a new document for signing</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Template selection */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold mb-4">1. Select Template</h2>

            {templateList.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">No templates available</p>
                <a href="/templates/upload" className="btn btn-primary">
                  Upload a Template
                </a>
              </div>
            ) : (
              <div className="grid gap-3">
                {templateList.map((template) => (
                  <label
                    key={template.id}
                    className={`flex items-center p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                      selectedTemplateId === template.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="template"
                      value={template.id}
                      checked={selectedTemplateId === template.id}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      className="sr-only"
                    />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{template.name}</p>
                      {template.description && (
                        <p className="text-sm text-gray-500">{template.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {Array.from(
                          new Set(
                            template.placeholders
                              .filter((p) => p.type !== 'TEXT')
                              .map((p) => p.role)
                          )
                        ).map((role) => (
                          <span
                            key={role}
                            className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded"
                          >
                            {role}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-full border-2 ml-4 ${
                        selectedTemplateId === template.id
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-gray-300'
                      }`}
                    >
                      {selectedTemplateId === template.id && (
                        <svg
                          className="w-full h-full text-white"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Recipients */}
          {selectedTemplate && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-4">2. Configure Recipients</h2>

              <div className="mb-4">
                <label className="label">Packet Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`${selectedTemplate.name} - ${new Date().toLocaleDateString()}`}
                  className="input"
                />
              </div>

              <div className="space-y-4">
                {recipients.map((recipient, index) => (
                  <div
                    key={recipient.roleName}
                    className="p-4 border border-gray-200 rounded-lg"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-sm font-medium flex items-center justify-center">
                          {recipient.order}
                        </span>
                        <span className="font-medium text-gray-900 capitalize">
                          {recipient.roleName}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => moveRecipient(index, 'up')}
                          disabled={index === 0}
                          className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveRecipient(index, 'down')}
                          disabled={index === recipients.length - 1}
                          className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        >
                          ↓
                        </button>
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
                        <label className="label">Email</label>
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

              <p className="mt-4 text-sm text-gray-500">
                Recipients will be notified in the order shown above (sequential signing).
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-700">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-4">
            <button
              type="submit"
              disabled={submitting || !selectedTemplateId || recipients.length === 0}
              className="btn btn-primary flex-1"
            >
              {submitting ? 'Creating...' : 'Create Packet'}
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
