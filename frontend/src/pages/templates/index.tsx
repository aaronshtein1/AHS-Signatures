import { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { templates, Template } from '@/lib/api';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

export default function TemplatesPage() {
  const [templateList, setTemplateList] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTemplates();
  }, []);

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

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;

    try {
      await templates.delete(id);
      setTemplateList(templateList.filter((t) => t.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete template');
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Templates</h1>
            <p className="text-gray-600">Manage your PDF templates</p>
          </div>
          <Link href="/templates/upload" className="btn btn-primary">
            Upload Template
          </Link>
        </div>

        {/* Template list */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-600 mb-4">{error}</p>
            <button onClick={loadTemplates} className="btn btn-primary">
              Retry
            </button>
          </div>
        ) : templateList.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-gray-500 mb-4">No templates uploaded yet</p>
            <Link href="/templates/upload" className="btn btn-primary">
              Upload your first template
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {templateList.map((template) => (
              <div key={template.id} className="card p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {template.name}
                    </h3>
                    {template.description && (
                      <p className="text-gray-600 mt-1">{template.description}</p>
                    )}
                    <div className="flex flex-wrap gap-4 mt-3 text-sm text-gray-500">
                      <span>
                        {template.placeholders?.length || 0} placeholder(s)
                      </span>
                      <span>•</span>
                      <span>{template.packetCount || 0} packet(s)</span>
                      <span>•</span>
                      <span>
                        Uploaded{' '}
                        {formatDistanceToNow(new Date(template.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    {template.placeholders && template.placeholders.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {Array.from(
                          new Set(
                            template.placeholders
                              .filter((p) => p.type !== 'TEXT')
                              .map((p) => p.role)
                          )
                        ).map((role) => (
                          <span
                            key={role}
                            className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded"
                          >
                            {role}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Link
                      href={`/packets/new?templateId=${template.id}`}
                      className="btn btn-primary btn-sm text-sm px-3 py-1"
                    >
                      Create Packet
                    </Link>
                    <button
                      onClick={() => handleDelete(template.id, template.name)}
                      className="btn btn-danger btn-sm text-sm px-3 py-1"
                      disabled={(template.packetCount || 0) > 0}
                      title={
                        (template.packetCount || 0) > 0
                          ? 'Cannot delete template with existing packets'
                          : 'Delete template'
                      }
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
