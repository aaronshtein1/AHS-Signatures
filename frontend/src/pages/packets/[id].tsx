import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import StatusBadge from '@/components/StatusBadge';
import { packets, Packet, AuditLog, admin, User } from '@/lib/api';
import { format, formatDistanceToNow } from 'date-fns';

function PacketDetailContent() {
  const router = useRouter();
  const { id } = router.query;
  const [packet, setPacket] = useState<Packet | null>(null);
  const [timeline, setTimeline] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState<string | null>(null); // recipientId being reassigned
  const [reassignName, setReassignName] = useState('');
  const [reassignEmail, setReassignEmail] = useState('');
  // Assign signer state (for pending_assignment packets)
  const [showAssign, setShowAssign] = useState(false);
  const [assignName, setAssignName] = useState('');
  const [assignEmail, setAssignEmail] = useState('');
  const [assignRole, setAssignRole] = useState('countersigner');
  const [assigning, setAssigning] = useState(false);
  // Users list for selection dropdowns
  const [users, setUsers] = useState<User[]>([]);
  const [retryingSharePoint, setRetryingSharePoint] = useState(false);

  useEffect(() => {
    admin.users().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    if (id && typeof id === 'string') {
      loadPacket(id);
    }
  }, [id]);

  const loadPacket = async (packetId: string) => {
    try {
      setLoading(true);
      const [packetData, timelineData] = await Promise.all([
        packets.get(packetId),
        packets.timeline(packetId),
      ]);
      setPacket(packetData);
      setTimeline(timelineData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load packet');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!packet) return;
    try {
      await packets.send(packet.id);
      loadPacket(packet.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const handleResend = async () => {
    if (!packet) return;
    try {
      await packets.resend(packet.id);
      alert('New signing link sent');
      loadPacket(packet.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to resend');
    }
  };

  const handleCancel = async () => {
    if (!packet || !confirm('Cancel this signing request?')) return;
    try {
      await packets.cancel(packet.id);
      loadPacket(packet.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel');
    }
  };

  const handleReassign = async (recipientId: string) => {
    if (!packet || !reassignName || !reassignEmail) return;
    try {
      await packets.reassign(packet.id, recipientId, {
        name: reassignName,
        email: reassignEmail,
      });
      setReassigning(null);
      setReassignName('');
      setReassignEmail('');
      loadPacket(packet.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reassign');
    }
  };

  const handleAssign = async () => {
    if (!packet || !assignName || !assignEmail) return;
    setAssigning(true);
    try {
      await packets.bulkAssign({
        packetIds: [packet.id],
        signerName: assignName,
        signerEmail: assignEmail,
        signerRole: assignRole,
      });
      setShowAssign(false);
      setAssignName('');
      setAssignEmail('');
      loadPacket(packet.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to assign');
    } finally {
      setAssigning(false);
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

  if (error || !packet) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-red-600 mb-4">{error || 'Packet not found'}</p>
          <button onClick={() => router.back()} className="btn btn-primary">
            Go Back
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{packet.name}</h1>
              <StatusBadge status={packet.status} />
            </div>
            <p className="text-gray-600 mt-1">Document: {packet.fileName}</p>
          </div>
          <div className="flex gap-2">
            {packet.status === 'pending_assignment' && (
              <button onClick={() => setShowAssign(true)} className="btn btn-primary bg-orange-500 hover:bg-orange-600 border-orange-500">
                Assign Signer
              </button>
            )}
            {packet.status === 'draft' && (
              <button onClick={handleSend} className="btn btn-success">
                Send for Signing
              </button>
            )}
            {(packet.status === 'sent' || packet.status === 'in_progress') && (
              <>
                <button onClick={handleResend} className="btn btn-secondary">
                  Resend Link
                </button>
                <button onClick={handleCancel} className="btn btn-danger">
                  Cancel
                </button>
              </>
            )}
            {packet.status === 'completed' && packet.signedPdfPath && (
              <a href={admin.downloadUrl(packet.id)} className="btn btn-primary" download>
                Download Signed PDF
              </a>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recipients */}
          <div className="lg:col-span-2 card">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold">Recipients</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {packet.recipients.length === 0 && (
                <div className="p-6 text-center">
                  <p className="text-orange-600 font-medium mb-2">No signer assigned</p>
                  <p className="text-sm text-gray-500 mb-4">This packet needs a signer before it can be sent.</p>
                  <button
                    onClick={() => setShowAssign(true)}
                    className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm font-medium"
                  >
                    Assign Signer
                  </button>
                </div>
              )}
              {packet.recipients.map((recipient) => (
                <div key={recipient.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-medium flex items-center justify-center">
                        {recipient.order}
                      </span>
                      <div>
                        <p className="font-medium text-gray-900">{recipient.name}</p>
                        <p className="text-sm text-gray-500">{recipient.email}</p>
                        <p className="text-xs text-gray-400 capitalize">
                          Role: {recipient.roleName}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={recipient.status} />
                      {recipient.signedAt && (
                        <p className="text-xs text-gray-400 mt-1">
                          Signed {format(new Date(recipient.signedAt), 'MMM d, yyyy h:mm a')}
                        </p>
                      )}
                    </div>
                  </div>
                  {recipient.signature && (
                    <div className="mt-3 pl-11">
                      <p className="text-sm text-gray-500">
                        Signed as: {recipient.signature.typedName}
                        {recipient.signature.signatureType === 'drawn' && ' (with drawn signature)'}
                      </p>
                    </div>
                  )}
                  {/* Reassign button for pending/notified recipients */}
                  {(recipient.status === 'pending' || recipient.status === 'notified') &&
                    packet.status !== 'completed' && packet.status !== 'cancelled' && (
                    <div className="mt-3 pl-11">
                      {reassigning === recipient.id ? (
                        <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                          <p className="text-sm font-medium text-gray-700">Reassign to:</p>
                          {users.length > 0 && (
                            <select
                              onChange={(e) => {
                                const user = users.find(u => u.id === e.target.value);
                                if (user) {
                                  setReassignName(user.name);
                                  setReassignEmail(user.email);
                                }
                              }}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="">-- Select user or enter manually --</option>
                              {users.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.name} ({user.email})
                                </option>
                              ))}
                            </select>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              placeholder="Name"
                              value={reassignName}
                              onChange={(e) => setReassignName(e.target.value)}
                              className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            />
                            <input
                              type="email"
                              placeholder="Email"
                              value={reassignEmail}
                              onChange={(e) => setReassignEmail(e.target.value)}
                              className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleReassign(recipient.id)}
                              disabled={!reassignName || !reassignEmail}
                              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                              Reassign & Send
                            </button>
                            <button
                              onClick={() => { setReassigning(null); setReassignName(''); setReassignEmail(''); }}
                              className="px-3 py-1 text-xs text-gray-600 bg-gray-200 rounded hover:bg-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setReassigning(recipient.id)}
                          className="text-sm text-blue-600 hover:text-blue-700"
                        >
                          Reassign
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Details */}
          <div className="card">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold">Details</h2>
            </div>
            <div className="p-6 space-y-4 text-sm">
              {packet.employeeName && (
                <div>
                  <p className="text-gray-500">Employee</p>
                  <p className="font-medium">{packet.employeeName}</p>
                  {packet.employeeEmail && (
                    <p className="text-xs text-gray-400">{packet.employeeEmail}</p>
                  )}
                </div>
              )}
              {packet.county && (
                <div>
                  <p className="text-gray-500">Location</p>
                  <p className="font-medium">{packet.county}</p>
                </div>
              )}
              <div>
                <p className="text-gray-500">Created</p>
                <p className="font-medium">
                  {format(new Date(packet.createdAt), 'MMM d, yyyy h:mm a')}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Last Updated</p>
                <p className="font-medium">
                  {formatDistanceToNow(new Date(packet.updatedAt), { addSuffix: true })}
                </p>
              </div>
              {packet.completedAt && (
                <div>
                  <p className="text-gray-500">Completed</p>
                  <p className="font-medium">
                    {format(new Date(packet.completedAt), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
              )}
              {/* All signed but the signed PDF was not generated (e.g. an error during stamping) */}
              {packet.status !== 'completed' && packet.status !== 'cancelled' &&
                packet.recipients.length > 0 && packet.recipients.every((r) => r.status === 'signed') && (
                <div className="pt-3 border-t border-gray-100">
                  <p className="text-gray-500 mb-1">Signed PDF</p>
                  <p className="text-xs text-red-600">All signers are done but the signed PDF was not generated.</p>
                  <button
                    onClick={async () => {
                      try {
                        await admin.finalize(packet.id);
                        loadPacket(packet.id);
                      } catch (err) {
                        alert(err instanceof Error ? err.message : 'Finalization failed');
                      }
                    }}
                    className="mt-2 px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Generate Signed PDF
                  </button>
                </div>
              )}
              {/* SharePoint Upload Status */}
              {packet.status === 'completed' && (packet.sharepointUrl || packet.sharepointError) && (
                <div className="pt-3 border-t border-gray-100">
                  <p className="text-gray-500 mb-1">SharePoint</p>
                  {packet.sharepointUrl ? (
                    <>
                      <p className="font-medium text-green-700 text-xs">Uploaded</p>
                      {packet.sharepointFolder && (
                        <p className="text-xs text-gray-600 mt-1">
                          Folder: <span className="font-medium">{packet.sharepointFolder}</span>
                        </p>
                      )}
                      <a
                        href={packet.sharepointUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-700 underline break-all mt-1 block"
                      >
                        View in SharePoint
                      </a>
                    </>
                  ) : packet.sharepointError ? (
                    <>
                      <p className="font-medium text-red-600 text-xs">Upload Failed</p>
                      <p className="text-xs text-red-500 mt-1 break-words">{packet.sharepointError}</p>
                      <button
                        onClick={async () => {
                          setRetryingSharePoint(true);
                          try {
                            await admin.sharepoint.retry(packet.id);
                            loadPacket(packet.id);
                          } catch (err) {
                            alert(err instanceof Error ? err.message : 'Retry failed');
                          } finally {
                            setRetryingSharePoint(false);
                          }
                        }}
                        disabled={retryingSharePoint}
                        className="mt-2 px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        {retryingSharePoint ? 'Retrying...' : 'Retry Upload'}
                      </button>
                    </>
                  ) : null}
                </div>
              )}
              {packet.status === 'completed' && !packet.sharepointUrl && !packet.sharepointError && (
                <div className="pt-3 border-t border-gray-100">
                  <p className="text-gray-500 mb-1">SharePoint</p>
                  <p className="text-xs text-gray-400">Not configured</p>
                </div>
              )}
              <div>
                <p className="text-gray-500">Packet ID</p>
                <p className="font-mono text-xs break-all">{packet.id}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Document Preview */}
        <div className="card">
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Document Preview</h2>
            <p className="text-sm text-gray-500">{packet.fileName}</p>
          </div>
          <div className="bg-gray-200">
            <iframe
              src={admin.previewUrl(packet.id)}
              className="w-full h-[600px]"
              title="Document Preview"
            />
          </div>
        </div>

        {/* Timeline */}
        <div className="card">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold">Activity Timeline</h2>
            <p className="text-sm text-gray-500 mt-1">
              Basic audit log for internal tracking (not a formal legal audit trail)
            </p>
          </div>
          <div className="p-6">
            {timeline.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No activity recorded</p>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

                <div className="space-y-6">
                  {timeline.map((log, index) => (
                    <div key={log.id} className="relative pl-10">
                      {/* Dot */}
                      <div
                        className={`absolute left-2.5 w-3 h-3 rounded-full ${
                          log.action === 'completed'
                            ? 'bg-green-500'
                            : log.action === 'uploaded'
                            ? 'bg-green-400'
                            : log.action === 'signed'
                            ? 'bg-blue-500'
                            : log.action === 'cancelled' || log.action === 'upload_failed'
                            ? 'bg-red-500'
                            : 'bg-gray-400'
                        }`}
                      />

                      <div>
                        <p className="font-medium text-gray-900">
                          {log.action.charAt(0).toUpperCase() + log.action.slice(1)}
                          {log.recipient && (
                            <span className="font-normal text-gray-600">
                              {' '}
                              - {log.recipient.name}
                            </span>
                          )}
                        </p>
                        {log.details && (
                          <p className="text-sm text-gray-500">{log.details}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          {format(new Date(log.createdAt), 'MMM d, yyyy h:mm:ss a')}
                        </p>
                        {(log.ipAddress || log.userAgent) && (
                          <details className="mt-2">
                            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                              Technical details
                            </summary>
                            <div className="mt-1 text-xs text-gray-400 font-mono bg-gray-50 p-2 rounded">
                              {log.ipAddress && <p>IP: {log.ipAddress}</p>}
                              {log.userAgent && (
                                <p className="truncate">UA: {log.userAgent}</p>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        {/* Assign Signer Modal */}
        {showAssign && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
              <h2 className="text-lg font-semibold mb-4">Assign Signer</h2>
              <p className="text-sm text-gray-500 mb-4">
                A signing request will be emailed to the assigned signer.
              </p>
              <div className="space-y-4">
                {users.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Select User</label>
                    <select
                      onChange={(e) => {
                        const user = users.find(u => u.id === e.target.value);
                        if (user) {
                          setAssignName(user.name);
                          setAssignEmail(user.email);
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    >
                      <option value="">-- Select user or enter manually --</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name} ({user.email})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Signer Name</label>
                  <input
                    type="text"
                    value={assignName}
                    onChange={(e) => setAssignName(e.target.value)}
                    placeholder="e.g., Jane Smith, RN"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Signer Email</label>
                  <input
                    type="email"
                    value={assignEmail}
                    onChange={(e) => setAssignEmail(e.target.value)}
                    placeholder="e.g., jsmith@homecare4all.org"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Signer Role</label>
                  <input
                    type="text"
                    value={assignRole}
                    onChange={(e) => setAssignRole(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Must match the placeholder role in the PDF</p>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowAssign(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssign}
                  disabled={assigning || !assignName || !assignEmail}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                >
                  {assigning ? 'Assigning...' : 'Assign & Send'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default function PacketDetailPage() {
  return (
    <ProtectedRoute requireAdmin>
      <PacketDetailContent />
    </ProtectedRoute>
  );
}
