import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import StatusBadge from '@/components/StatusBadge';
import { packets, Packet, admin, User, userDocs } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function PacketsPageContent() {
  const router = useRouter();
  const { user } = useAuth();
  const { status: filterStatus } = router.query;
  const [packetList, setPacketList] = useState<Packet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Users list for selection
  const [users, setUsers] = useState<User[]>([]);

  // Bulk assign state
  const [selectedPackets, setSelectedPackets] = useState<Set<string>>(new Set());
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkSignerName, setBulkSignerName] = useState('');
  const [bulkSignerEmail, setBulkSignerEmail] = useState('');
  const [bulkSignerRole, setBulkSignerRole] = useState('countersigner');
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [assigningToSelf, setAssigningToSelf] = useState(false);

  // PDF preview state
  const [previewPacket, setPreviewPacket] = useState<Packet | null>(null);

  const isUnassignedView = filterStatus === 'pending_assignment';

  useEffect(() => {
    setSelectedPackets(new Set());
    loadPackets();
  }, [filterStatus]);

  // Load users for selection dropdown
  useEffect(() => {
    admin.users()
      .then(setUsers)
      .catch(() => {}); // Silently fail if can't load users
  }, []);

  const loadPackets = async () => {
    try {
      setLoading(true);
      const params = filterStatus ? { status: filterStatus as string } : undefined;
      const data = await packets.list(params);
      setPacketList(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load packets');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (id: string) => {
    try {
      await packets.send(id);
      loadPackets();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to send packet');
    }
  };

  const handleResend = async (id: string) => {
    try {
      await packets.resend(id);
      alert('New signing link sent');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to resend');
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this signing request?')) return;
    try {
      await packets.cancel(id);
      loadPackets();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this draft packet?')) return;
    try {
      await packets.delete(id);
      loadPackets();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedPackets);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedPackets(next);
  };

  const toggleSelectAll = () => {
    if (selectedPackets.size === packetList.length) {
      setSelectedPackets(new Set());
    } else {
      setSelectedPackets(new Set(packetList.map(p => p.id)));
    }
  };

  const selectUser = (userId: string) => {
    const selected = users.find(u => u.id === userId);
    if (selected) {
      setBulkSignerName(selected.name);
      setBulkSignerEmail(selected.email);
    }
  };

  const handleAssignToSelfAndSign = async () => {
    if (!user || selectedPackets.size === 0) return;
    setAssigningToSelf(true);
    try {
      const result = await packets.bulkAssign({
        packetIds: Array.from(selectedPackets),
        signerName: user.name,
        signerEmail: user.email,
        signerRole: bulkSignerRole,
      });

      if (result.assigned === 0) {
        alert('Failed to assign packets');
        return;
      }

      // If single packet, navigate directly to signing
      if (selectedPackets.size === 1) {
        // Fetch user's documents to find the newly assigned one
        const docs = await userDocs.list();
        const packetId = Array.from(selectedPackets)[0];
        const doc = docs.find(d => d.packet.id === packetId && d.canSign);
        if (doc) {
          const { signUrl } = await userDocs.getSignUrl(doc.id);
          router.push(signUrl);
          return;
        }
      }

      // Multiple packets or couldn't find sign URL - go to My Documents
      alert(`Assigned ${result.assigned} packet(s) to yourself. Redirecting to My Documents.`);
      router.push('/my-documents');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to assign');
    } finally {
      setAssigningToSelf(false);
    }
  };

  const handleBulkAssign = async () => {
    if (!bulkSignerName || !bulkSignerEmail) return;
    setBulkAssigning(true);
    try {
      const result = await packets.bulkAssign({
        packetIds: Array.from(selectedPackets),
        signerName: bulkSignerName,
        signerEmail: bulkSignerEmail,
        signerRole: bulkSignerRole,
      });
      alert(`Assigned ${result.assigned} of ${result.total} packet(s)${result.errors.length > 0 ? `. ${result.errors.length} error(s).` : ''}`);
      setShowBulkAssign(false);
      setSelectedPackets(new Set());
      setBulkSignerName('');
      setBulkSignerEmail('');
      loadPackets();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to assign packets');
    } finally {
      setBulkAssigning(false);
    }
  };

  const statusFilters = [
    { value: '', label: 'All' },
    { value: 'pending_assignment', label: 'Unassigned' },
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Sent' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  // Group unassigned packets by form name for easier viewing
  const formNames = isUnassignedView
    ? Array.from(new Set(packetList.map(p => p.name.split(' - ')[0]).filter(Boolean))).sort()
    : [];

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Signing Packets</h1>
            <p className="text-gray-600">Manage document signing requests</p>
          </div>
          <Link href="/packets/new" className="btn btn-primary">
            Create Packet
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {statusFilters.map((filter) => (
            <Link
              key={filter.value}
              href={filter.value ? `/packets?status=${filter.value}` : '/packets'}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                (filterStatus || '') === filter.value
                  ? filter.value === 'pending_assignment'
                    ? 'bg-orange-500 text-white'
                    : 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {filter.label}
            </Link>
          ))}
        </div>

        {/* Bulk assign toolbar (unassigned view) */}
        {isUnassignedView && packetList.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selectedPackets.size === packetList.length && packetList.length > 0}
                onChange={toggleSelectAll}
                className="h-4 w-4 text-orange-600 rounded"
              />
              <span className="text-sm text-orange-800">
                {selectedPackets.size > 0
                  ? `${selectedPackets.size} of ${packetList.length} selected`
                  : `${packetList.length} unassigned packet${packetList.length > 1 ? 's' : ''}`}
              </span>
              {formNames.length > 1 && (
                <span className="text-xs text-orange-600">
                  ({formNames.length} form types)
                </span>
              )}
            </div>
            <button
              onClick={() => setShowBulkAssign(true)}
              disabled={selectedPackets.size === 0}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 text-sm font-medium"
            >
              Assign Selected ({selectedPackets.size})
            </button>
          </div>
        )}

        {/* Packet list */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-600 mb-4">{error}</p>
            <button onClick={loadPackets} className="btn btn-primary">
              Retry
            </button>
          </div>
        ) : packetList.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-gray-500 mb-4">
              {filterStatus
                ? `No ${String(filterStatus).replace(/_/g, ' ')} packets`
                : 'No packets created yet'}
            </p>
            {!filterStatus && (
              <Link href="/packets/new" className="btn btn-primary">
                Create your first packet
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {packetList.map((packet) => (
              <div key={packet.id} className="card p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    {/* Checkbox for unassigned */}
                    {isUnassignedView && (
                      <input
                        type="checkbox"
                        checked={selectedPackets.has(packet.id)}
                        onChange={() => toggleSelect(packet.id)}
                        className="mt-1.5 h-4 w-4 text-orange-600 rounded"
                      />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/packets/${packet.id}`}
                          className="text-lg font-semibold text-gray-900 hover:text-blue-600"
                        >
                          {packet.name}
                        </Link>
                        <StatusBadge status={packet.status} />
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        Document: {packet.fileName}
                        {packet.employeeName && (
                          <span className="ml-2">| Employee: {packet.employeeName}</span>
                        )}
                        {packet.county && (
                          <span className="ml-2">| Location: {packet.county}</span>
                        )}
                      </p>

                      {/* Recipients */}
                      {packet.recipients.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {packet.recipients.map((recipient) => (
                            <div
                              key={recipient.id}
                              className="flex items-center gap-2 px-2 py-1 bg-gray-50 rounded text-sm"
                            >
                              <span className="font-medium">{recipient.name}</span>
                              <span className="text-gray-400">({recipient.roleName})</span>
                              <StatusBadge status={recipient.status} size="sm" />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-orange-600 font-medium">
                          No signer assigned yet
                        </p>
                      )}

                      <p className="text-xs text-gray-400 mt-3">
                        Created{' '}
                        {formatDistanceToNow(new Date(packet.createdAt), {
                          addSuffix: true,
                        })}
                        {packet.completedAt && (
                          <>
                            {' \u2022 Completed '}
                            {formatDistanceToNow(new Date(packet.completedAt), {
                              addSuffix: true,
                            })}
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => setPreviewPacket(packet)}
                      className="btn btn-secondary text-sm px-3 py-1"
                      title="Preview PDF"
                    >
                      Preview
                    </button>
                    <Link
                      href={`/packets/${packet.id}`}
                      className="btn btn-secondary text-sm px-3 py-1"
                    >
                      View
                    </Link>

                    {packet.status === 'draft' && (
                      <>
                        <button
                          onClick={() => handleSend(packet.id)}
                          className="btn btn-success text-sm px-3 py-1"
                        >
                          Send
                        </button>
                        <button
                          onClick={() => handleDelete(packet.id)}
                          className="btn btn-danger text-sm px-3 py-1"
                        >
                          Delete
                        </button>
                      </>
                    )}

                    {(packet.status === 'sent' || packet.status === 'in_progress') && (
                      <>
                        <button
                          onClick={() => handleResend(packet.id)}
                          className="btn btn-secondary text-sm px-3 py-1"
                        >
                          Resend
                        </button>
                        <button
                          onClick={() => handleCancel(packet.id)}
                          className="btn btn-danger text-sm px-3 py-1"
                        >
                          Cancel
                        </button>
                      </>
                    )}

                    {packet.status === 'completed' && packet.signedPdfPath && (
                      <a
                        href={admin.downloadUrl(packet.id)}
                        className="btn btn-primary text-sm px-3 py-1"
                        download
                      >
                        Download
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* PDF Preview Modal */}
        {previewPacket && (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[85vh] flex flex-col">
              <div className="flex items-center justify-between p-4 border-b">
                <div>
                  <h2 className="text-lg font-semibold">{previewPacket.name}</h2>
                  <p className="text-sm text-gray-500">{previewPacket.fileName}</p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`${API_URL}/uploads/${previewPacket.filePath}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                  >
                    Open in new tab
                  </a>
                  <button
                    onClick={() => setPreviewPacket(null)}
                    className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                <iframe
                  src={`${API_URL}/uploads/${previewPacket.filePath}`}
                  className="w-full h-full border-0"
                  title={`Preview: ${previewPacket.fileName}`}
                />
              </div>
            </div>
          </div>
        )}

        {/* Bulk Assign Modal */}
        {showBulkAssign && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
              <h2 className="text-lg font-semibold mb-4">
                Assign {selectedPackets.size} Packet{selectedPackets.size > 1 ? 's' : ''}
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                A signing request will be emailed to the assigned signer for each packet.
              </p>

              {/* Assign to Me shortcut */}
              {user && (
                <button
                  onClick={handleAssignToSelfAndSign}
                  disabled={assigningToSelf || bulkAssigning}
                  className="w-full mb-4 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium text-sm"
                >
                  {assigningToSelf ? 'Assigning...' : `Assign to Me (${user.name}) & Sign`}
                </button>
              )}

              <div className="relative mb-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-white px-2 text-gray-500">or assign to someone else</span>
                </div>
              </div>

              <div className="space-y-4">
                {/* User Selection */}
                {users.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Select User</label>
                    <select
                      value={users.find(u => u.name === bulkSignerName && u.email === bulkSignerEmail)?.id || ''}
                      onChange={(e) => {
                        if (e.target.value) {
                          selectUser(e.target.value);
                        } else {
                          setBulkSignerName('');
                          setBulkSignerEmail('');
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    >
                      <option value="">-- Enter manually --</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.email})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Signer Name</label>
                  <input
                    type="text"
                    value={bulkSignerName}
                    onChange={(e) => setBulkSignerName(e.target.value)}
                    placeholder="e.g., Jane Smith, RN"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Signer Email</label>
                  <input
                    type="email"
                    value={bulkSignerEmail}
                    onChange={(e) => setBulkSignerEmail(e.target.value)}
                    placeholder="e.g., jsmith@homecare4all.org"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Signer Role</label>
                  <input
                    type="text"
                    value={bulkSignerRole}
                    onChange={(e) => setBulkSignerRole(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Must match the placeholder role in the PDF</p>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowBulkAssign(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkAssign}
                  disabled={bulkAssigning || assigningToSelf || !bulkSignerName || !bulkSignerEmail}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                >
                  {bulkAssigning ? 'Assigning...' : 'Assign & Send'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default function PacketsPage() {
  return (
    <ProtectedRoute requireAdmin>
      <PacketsPageContent />
    </ProtectedRoute>
  );
}
