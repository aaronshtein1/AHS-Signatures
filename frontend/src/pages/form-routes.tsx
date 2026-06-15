import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { admin, FormRoute, CreateFormRouteData, PullResult } from '@/lib/api';

function FormRoutesPageContent() {
  const router = useRouter();
  const [routes, setRoutes] = useState<FormRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRoute, setEditingRoute] = useState<FormRoute | null>(null);
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullResult, setPullResult] = useState<PullResult | null>(null);
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [driveConfigured, setDriveConfigured] = useState(false);

  // Form state
  const [formData, setFormData] = useState<CreateFormRouteData>({
    jotformFormId: '',
    formName: '',
    signerEmail: '',
    signerName: '',
    signerRole: 'countersigner',
    driveFolderId: '',
    sharepointFolder: '',
  });

  useEffect(() => {
    loadRoutes();
    checkDriveStatus();

    // Check for Google OAuth callback params
    const { google: googleParam, error: errorParam } = router.query;
    if (googleParam === 'connected') {
      setDriveConnected(true);
      router.replace('/form-routes', undefined, { shallow: true });
    }
    if (errorParam === 'google_denied' || errorParam === 'google_auth_failed') {
      setError('Google Drive authorization failed. Please try again.');
      router.replace('/form-routes', undefined, { shallow: true });
    }
  }, []);

  const loadRoutes = async () => {
    try {
      setLoading(true);
      const data = await admin.formRoutes.list();
      setRoutes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load form routes');
    } finally {
      setLoading(false);
    }
  };

  const checkDriveStatus = async () => {
    try {
      const status = await admin.google.status();
      setDriveConnected(status.connected);
      setDriveConfigured(status.configured);
    } catch {
      // Google Drive status check failed — not critical
    }
  };

  const handleConnectDrive = async () => {
    try {
      const { url } = await admin.google.authUrl();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get authorization URL');
    }
  };

  const resetForm = () => {
    setFormData({
      jotformFormId: '',
      formName: '',
      signerEmail: '',
      signerName: '',
      signerRole: 'countersigner',
      driveFolderId: '',
      sharepointFolder: '',
    });
    setEditingRoute(null);
    setShowForm(false);
  };

  const handleEdit = (route: FormRoute) => {
    setFormData({
      jotformFormId: route.jotformFormId,
      formName: route.formName,
      signerEmail: route.signerEmail || '',
      signerName: route.signerName || '',
      signerRole: route.signerRole,
      driveFolderId: route.driveFolderId || '',
      sharepointFolder: route.sharepointFolder || '',
    });
    setEditingRoute(route);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (editingRoute) {
        await admin.formRoutes.update(editingRoute.id, formData);
      } else {
        await admin.formRoutes.create(formData);
      }
      resetForm();
      await loadRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save form route');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete form route "${name}"? This cannot be undone.`)) return;

    try {
      await admin.formRoutes.delete(id);
      await loadRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete form route');
    }
  };

  const handlePull = async (route: FormRoute) => {
    setPulling(route.id);
    setPullResult(null);
    setError(null);

    try {
      const result = await admin.formRoutes.pull(route.id, 30);
      setPullResult(result);
      if (result.created > 0) {
        loadRoutes(); // Refresh in case status changed
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pull from Google Drive');
    } finally {
      setPulling(null);
    }
  };

  const handleToggleActive = async (route: FormRoute) => {
    try {
      await admin.formRoutes.update(route.id, { isActive: !route.isActive });
      await loadRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update form route');
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Form Routes</h1>
            <p className="mt-1 text-sm text-gray-500">
              Configure JotForm form routes. PDFs are pulled from Google Drive folders where JotForm auto-saves submissions.
            </p>
          </div>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Add Form Route
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Google Drive Connection Status */}
        {driveConfigured && driveConnected === false && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-yellow-800">Google Drive Not Connected</h3>
              <p className="text-sm text-yellow-700">
                Connect Google Drive to pull submission PDFs from your JotForm folders.
              </p>
            </div>
            <button
              onClick={handleConnectDrive}
              className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 text-sm font-medium"
            >
              Connect Google Drive
            </button>
          </div>
        )}
        {driveConnected === true && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-green-500"></span>
            <span className="text-sm text-green-800 font-medium">Google Drive connected</span>
          </div>
        )}
        {!driveConfigured && driveConnected !== null && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
            <p className="text-sm text-gray-600">
              Google Drive not configured. Add <code className="bg-gray-100 px-1 rounded">GOOGLE_CLIENT_ID</code> and{' '}
              <code className="bg-gray-100 px-1 rounded">GOOGLE_CLIENT_SECRET</code> to your backend .env file.
            </p>
          </div>
        )}

        {/* Pull Result */}
        {pullResult && (
          <div className={`border rounded-lg px-4 py-3 ${
            pullResult.errors.length > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'
          }`}>
            <p className="text-sm font-medium">
              Pull complete: {pullResult.created} created, {pullResult.skipped} already processed, out of {pullResult.total} files
            </p>
            {pullResult.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-yellow-800">Errors:</p>
                <ul className="text-xs text-yellow-700 list-disc list-inside">
                  {pullResult.errors.slice(0, 5).map((err, i) => <li key={i}>{err}</li>)}
                  {pullResult.errors.length > 5 && (
                    <li>...and {pullResult.errors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
            <button onClick={() => setPullResult(null)} className="text-xs text-gray-500 hover:text-gray-700 mt-1">
              Dismiss
            </button>
          </div>
        )}

        {/* Add/Edit Form */}
        {showForm && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">
              {editingRoute ? 'Edit Form Route' : 'New Form Route'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    JotForm Form ID
                  </label>
                  <input
                    type="text"
                    value={formData.jotformFormId}
                    onChange={(e) => setFormData({ ...formData, jotformFormId: e.target.value })}
                    placeholder="e.g., 241234567890"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                    disabled={!!editingRoute}
                  />
                  <p className="mt-1 text-xs text-gray-500">Found in your JotForm URL</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Form Name
                  </label>
                  <input
                    type="text"
                    value={formData.formName}
                    onChange={(e) => setFormData({ ...formData, formName: e.target.value })}
                    placeholder="e.g., HHA/PCA In-Service"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Google Drive Folder ID
                  </label>
                  <input
                    type="text"
                    value={formData.driveFolderId || ''}
                    onChange={(e) => setFormData({ ...formData, driveFolderId: e.target.value })}
                    placeholder="e.g., 1abc...xyz"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    From the Google Drive folder URL after /folders/
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Signer Role
                  </label>
                  <input
                    type="text"
                    value={formData.signerRole}
                    onChange={(e) => setFormData({ ...formData, signerRole: e.target.value })}
                    placeholder="e.g., countersigner, rn, compliance"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">Must match the placeholder role in the PDF</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Countersigner Name <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.signerName || ''}
                    onChange={(e) => setFormData({ ...formData, signerName: e.target.value })}
                    placeholder="e.g., Jane Smith, RN"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">Leave blank to require manual assignment after pull</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Countersigner Email <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="email"
                    value={formData.signerEmail || ''}
                    onChange={(e) => setFormData({ ...formData, signerEmail: e.target.value })}
                    placeholder="e.g., jsmith@homecare4all.org"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    SharePoint Folder (optional)
                  </label>
                  <input
                    type="text"
                    value={formData.sharepointFolder || ''}
                    onChange={(e) => setFormData({ ...formData, sharepointFolder: e.target.value })}
                    placeholder="e.g., Medical Forms"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">Subfolder in SharePoint for this form type</p>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving...' : editingRoute ? 'Update Route' : 'Create Route'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Routes Table */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading form routes...</div>
        ) : routes.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">No form routes configured yet.</p>
            <button
              onClick={() => { resetForm(); setShowForm(true); }}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              Create your first form route
            </button>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Form</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Countersigner</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Drive</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {routes.map((route) => (
                  <tr key={route.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{route.formName}</div>
                      <div className="text-xs text-gray-500 font-mono">{route.jotformFormId}</div>
                    </td>
                    <td className="px-6 py-4">
                      {route.signerName ? (
                        <>
                          <div className="text-sm text-gray-900">{route.signerName}</div>
                          <div className="text-xs text-gray-500">{route.signerEmail}</div>
                        </>
                      ) : (
                        <div className="text-sm text-orange-600 font-medium">Manual Assignment</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {route.driveFolderId ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-1 rounded-full">
                          Configured
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Not set</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleToggleActive(route)}
                        className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          route.isActive
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {route.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => handlePull(route)}
                        disabled={pulling === route.id || !route.driveFolderId || !driveConnected}
                        title={!route.driveFolderId ? 'Set a Drive Folder ID first' : !driveConnected ? 'Connect Google Drive first' : 'Pull new PDFs from Google Drive'}
                        className="text-sm text-green-600 hover:text-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {pulling === route.id ? 'Pulling...' : 'Pull'}
                      </button>
                      <button
                        onClick={() => handleEdit(route)}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(route.id, route.formName)}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default function FormRoutesPage() {
  return (
    <ProtectedRoute requireAdmin>
      <FormRoutesPageContent />
    </ProtectedRoute>
  );
}
