import { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import StatusBadge from '@/components/StatusBadge';
import { admin, DashboardStats } from '@/lib/api';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await admin.stats();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setLoading(false);
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

  if (error) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={loadStats} className="btn btn-primary">
            Retry
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">Overview of your signing activity</p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-6">
            <p className="text-sm text-gray-500">Templates</p>
            <p className="text-3xl font-bold text-gray-900">{stats?.templates || 0}</p>
            <Link href="/templates" className="text-sm text-blue-600 hover:underline">
              Manage templates →
            </Link>
          </div>

          <div className="card p-6">
            <p className="text-sm text-gray-500">Total Packets</p>
            <p className="text-3xl font-bold text-gray-900">{stats?.totalPackets || 0}</p>
            <Link href="/packets" className="text-sm text-blue-600 hover:underline">
              View all packets →
            </Link>
          </div>

          <div className="card p-6">
            <p className="text-sm text-gray-500">In Progress</p>
            <p className="text-3xl font-bold text-yellow-600">
              {(stats?.packets.sent || 0) + (stats?.packets.in_progress || 0)}
            </p>
            <Link href="/packets?status=in_progress" className="text-sm text-blue-600 hover:underline">
              View active →
            </Link>
          </div>

          <div className="card p-6">
            <p className="text-sm text-gray-500">Completed</p>
            <p className="text-3xl font-bold text-green-600">{stats?.packets.completed || 0}</p>
            <Link href="/packets?status=completed" className="text-sm text-blue-600 hover:underline">
              View completed →
            </Link>
          </div>
        </div>

        {/* Status breakdown */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold mb-4">Packets by Status</h2>
          <div className="flex flex-wrap gap-4">
            {stats?.packets &&
              Object.entries(stats.packets).map(([status, count]) => (
                <div key={status} className="flex items-center gap-2">
                  <StatusBadge status={status} />
                  <span className="text-gray-700 font-medium">{count}</span>
                </div>
              ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="card">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold">Recent Activity</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {stats?.recentActivity && stats.recentActivity.length > 0 ? (
              stats.recentActivity.map((log) => (
                <div key={log.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {log.action.charAt(0).toUpperCase() + log.action.slice(1)}
                        {log.recipient && (
                          <span className="text-gray-600"> by {log.recipient.name}</span>
                        )}
                      </p>
                      {log.packet && (
                        <p className="text-sm text-gray-500">{log.packet.name}</p>
                      )}
                      {log.details && (
                        <p className="text-xs text-gray-400 mt-1">{log.details}</p>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">
                      {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-gray-500">
                No recent activity
              </div>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-4">
          <Link href="/templates/upload" className="btn btn-primary">
            Upload Template
          </Link>
          <Link href="/packets/new" className="btn btn-secondary">
            Create Packet
          </Link>
        </div>
      </div>
    </Layout>
  );
}
