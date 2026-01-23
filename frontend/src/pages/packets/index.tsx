import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import StatusBadge from '@/components/StatusBadge';
import { packets, Packet, admin } from '@/lib/api';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

export default function PacketsPage() {
  const router = useRouter();
  const { status: filterStatus } = router.query;
  const [packetList, setPacketList] = useState<Packet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPackets();
  }, [filterStatus]);

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

  const statusFilters = [
    { value: '', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Sent' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

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
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {filter.label}
            </Link>
          ))}
        </div>

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
                ? `No ${filterStatus.replace('_', ' ')} packets`
                : 'No packets created yet'}
            </p>
            <Link href="/packets/new" className="btn btn-primary">
              Create your first packet
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {packetList.map((packet) => (
              <div key={packet.id} className="card p-6">
                <div className="flex items-start justify-between">
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
                      Template: {packet.template.name}
                    </p>

                    {/* Recipients */}
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

                    <p className="text-xs text-gray-400 mt-3">
                      Created{' '}
                      {formatDistanceToNow(new Date(packet.createdAt), {
                        addSuffix: true,
                      })}
                      {packet.completedAt && (
                        <>
                          {' • Completed '}
                          {formatDistanceToNow(new Date(packet.completedAt), {
                            addSuffix: true,
                          })}
                        </>
                      )}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 ml-4">
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
      </div>
    </Layout>
  );
}
