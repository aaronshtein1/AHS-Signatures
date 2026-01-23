import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import StatusBadge from '@/components/StatusBadge';
import { packets, Packet, AuditLog, admin } from '@/lib/api';
import { format, formatDistanceToNow } from 'date-fns';

export default function PacketDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [packet, setPacket] = useState<Packet | null>(null);
  const [timeline, setTimeline] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            <p className="text-gray-600 mt-1">Template: {packet.template.name}</p>
          </div>
          <div className="flex gap-2">
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
              <div>
                <p className="text-gray-500">Packet ID</p>
                <p className="font-mono text-xs break-all">{packet.id}</p>
              </div>
            </div>
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
                            : log.action === 'signed'
                            ? 'bg-blue-500'
                            : log.action === 'cancelled'
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
      </div>
    </Layout>
  );
}
