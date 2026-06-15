import { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { admin, AnalyticsResponse, userDocs, UserDocument } from '@/lib/api';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { format, formatDistanceToNow } from 'date-fns';
import {
  PieChart, Pie, Cell, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const STATUS_COLORS: Record<string, string> = {
  draft: '#9CA3AF',
  pending_assignment: '#F97316',
  sent: '#3B82F6',
  in_progress: '#EAB308',
  completed: '#22C55E',
  cancelled: '#EF4444',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_assignment: 'Unassigned',
  sent: 'Sent',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const DAY_OPTIONS = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: 'All', value: 365 },
];

function DashboardContent() {
  const router = useRouter();
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [pendingDocs, setPendingDocs] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [days, setDays] = useState(30);
  const [formRouteId, setFormRouteId] = useState('');
  const [county, setCounty] = useState('');

  useEffect(() => {
    userDocs.list().then(docs => setPendingDocs(docs.filter(d => d.canSign))).catch(() => {});
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [days, formRouteId, county]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await admin.analytics({
        days,
        ...(formRouteId ? { formRouteId } : {}),
        ...(county ? { county } : {}),
      });
      setAnalytics(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  const formatAvgTime = (hours: number | null) => {
    if (hours === null) return 'N/A';
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 24) return `${hours}h`;
    const d = Math.floor(hours / 24);
    const h = Math.round(hours % 24);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  };

  if (loading && !analytics) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </Layout>
    );
  }

  if (error && !analytics) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={loadAnalytics} className="btn btn-primary">Retry</button>
        </div>
      </Layout>
    );
  }

  const kpis = analytics?.kpis;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500">Signing workflow overview</p>
          </div>
          <Link href="/packets/new" className="btn btn-primary">
            Create Packet
          </Link>
        </div>

        {/* Pending Your Signature */}
        {pendingDocs.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-500" />
              </span>
              <h2 className="text-sm font-semibold text-orange-800">
                {pendingDocs.length} document{pendingDocs.length > 1 ? 's' : ''} pending your signature
              </h2>
            </div>
            <div className="space-y-2">
              {pendingDocs.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between bg-white rounded px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{doc.packet.name}</p>
                    <p className="text-xs text-gray-500">Role: {doc.roleName}</p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const { signUrl } = await userDocs.getSignUrl(doc.id);
                        router.push(signUrl);
                      } catch {}
                    }}
                    className="px-3 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600"
                  >
                    Sign Now
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Date range */}
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-500 mr-1">Period:</span>
              {DAY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDays(opt.value)}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    days === opt.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Form route filter */}
            {analytics && analytics.filterOptions.formRoutes.length > 0 && (
              <select
                value={formRouteId}
                onChange={(e) => setFormRouteId(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Form Types</option>
                {analytics.filterOptions.formRoutes.map((r) => (
                  <option key={r.id} value={r.id}>{r.formName}</option>
                ))}
              </select>
            )}

            {/* County filter */}
            {analytics && analytics.filterOptions.counties.length > 0 && (
              <select
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Counties</option>
                {analytics.filterOptions.counties.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}

            {loading && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
            )}
          </div>
        </div>

        {/* KPI Cards */}
        {kpis && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Link href="/packets" className="card p-5 hover:shadow-md transition-shadow">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{kpis.totalPackets}</p>
            </Link>

            <Link href="/packets?status=pending_assignment" className="card p-5 border-l-4 border-orange-500 hover:shadow-md transition-shadow">
              <p className="text-xs font-medium text-orange-600 uppercase tracking-wide">Needs Assignment</p>
              <p className="text-3xl font-bold text-orange-600 mt-1">{kpis.needsAssignment}</p>
            </Link>

            <Link href="/packets?status=in_progress" className="card p-5 hover:shadow-md transition-shadow">
              <p className="text-xs font-medium text-yellow-600 uppercase tracking-wide">In Progress</p>
              <p className="text-3xl font-bold text-yellow-600 mt-1">{kpis.inProgress}</p>
            </Link>

            <Link href="/packets?status=completed" className="card p-5 hover:shadow-md transition-shadow">
              <p className="text-xs font-medium text-green-600 uppercase tracking-wide">Completed</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{kpis.completed}</p>
            </Link>

            <div className="card p-5">
              <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">Avg Completion</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">{formatAvgTime(kpis.avgCompletionHours)}</p>
            </div>
          </div>
        )}

        {/* Charts Row 1: Status Donut + Completion Trend */}
        {analytics && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Status Distribution Donut */}
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Status Distribution</h3>
              {analytics.statusDistribution.length > 0 ? (
                <div className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={analytics.statusDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="count"
                        nameKey="label"
                      >
                        {analytics.statusDistribution.map((entry) => (
                          <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || '#9CA3AF'} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: any, name: any) => [value, name]}
                        contentStyle={{ fontSize: 13, borderRadius: 8 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
                    {analytics.statusDistribution.map((entry) => (
                      <div key={entry.status} className="flex items-center gap-1.5 text-xs text-gray-600">
                        <span
                          className="w-2.5 h-2.5 rounded-full inline-block"
                          style={{ backgroundColor: STATUS_COLORS[entry.status] }}
                        />
                        {entry.label}: {entry.count}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-gray-400 text-sm text-center py-12">No data for this period</p>
              )}
            </div>

            {/* Completion Trend */}
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Activity Trend</h3>
              {analytics.completionTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={analytics.completionTrend}>
                    <defs>
                      <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22C55E" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#22C55E" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(d) => format(new Date(d + 'T00:00:00'), 'MMM d')}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(d) => format(new Date(d + 'T00:00:00'), 'MMM d, yyyy')}
                      contentStyle={{ fontSize: 13, borderRadius: 8 }}
                    />
                    <Area type="monotone" dataKey="created" name="Created" stroke="#3B82F6" fill="url(#colorCreated)" strokeWidth={2} />
                    <Area type="monotone" dataKey="completed" name="Completed" stroke="#22C55E" fill="url(#colorCompleted)" strokeWidth={2} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray-400 text-sm text-center py-12">No data for this period</p>
              )}
            </div>
          </div>
        )}

        {/* Charts Row 2: By Form Route + By County */}
        {analytics && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By Form Route */}
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">By Document Type</h3>
              {analytics.byFormRoute.length > 0 ? (
                <ResponsiveContainer width="100%" height={Math.max(200, analytics.byFormRoute.length * 40 + 40)}>
                  <BarChart data={analytics.byFormRoute} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="formName"
                      tick={{ fontSize: 11 }}
                      width={120}
                    />
                    <Tooltip contentStyle={{ fontSize: 13, borderRadius: 8 }} />
                    <Bar dataKey="completed" name="Completed" stackId="a" fill={STATUS_COLORS.completed} />
                    <Bar dataKey="in_progress" name="In Progress" stackId="a" fill={STATUS_COLORS.in_progress} />
                    <Bar dataKey="sent" name="Sent" stackId="a" fill={STATUS_COLORS.sent} />
                    <Bar dataKey="pending_assignment" name="Unassigned" stackId="a" fill={STATUS_COLORS.pending_assignment} />
                    <Bar dataKey="draft" name="Draft" stackId="a" fill={STATUS_COLORS.draft} radius={[0, 4, 4, 0]} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray-400 text-sm text-center py-12">No data for this period</p>
              )}
            </div>

            {/* By County */}
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">By County / Location</h3>
              {analytics.byCounty.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={analytics.byCounty.slice(0, 10)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="county" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 13, borderRadius: 8 }} />
                    <Bar dataKey="count" name="Total" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="completed" name="Completed" fill="#22C55E" radius={[4, 4, 0, 0]} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray-400 text-sm text-center py-12">No county data available</p>
              )}
            </div>
          </div>
        )}

        {/* Needs Attention Table */}
        {analytics && analytics.needsAttention.length > 0 && (
          <div className="card">
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Needs Attention</h3>
                <p className="text-xs text-gray-500 mt-0.5">Packets waiting for signer assignment</p>
              </div>
              <Link href="/packets?status=pending_assignment" className="text-sm text-blue-600 hover:underline">
                View all
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-5 text-xs font-medium text-gray-500 uppercase tracking-wide">Document</th>
                    <th className="text-left py-3 px-5 text-xs font-medium text-gray-500 uppercase tracking-wide">Employee</th>
                    <th className="text-left py-3 px-5 text-xs font-medium text-gray-500 uppercase tracking-wide">County</th>
                    <th className="text-left py-3 px-5 text-xs font-medium text-gray-500 uppercase tracking-wide">Created</th>
                    <th className="text-right py-3 px-5 text-xs font-medium text-gray-500 uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {analytics.needsAttention.slice(0, 10).map((pkt) => (
                    <tr key={pkt.id} className="hover:bg-gray-50">
                      <td className="py-3 px-5">
                        <p className="font-medium text-gray-900 truncate max-w-[200px]">{pkt.formName || pkt.name}</p>
                      </td>
                      <td className="py-3 px-5 text-gray-600">{pkt.employeeName || '—'}</td>
                      <td className="py-3 px-5 text-gray-600">{pkt.county || '—'}</td>
                      <td className="py-3 px-5 text-gray-500 text-xs">
                        {formatDistanceToNow(new Date(pkt.createdAt), { addSuffix: true })}
                      </td>
                      <td className="py-3 px-5 text-right">
                        <Link
                          href={`/packets/${pkt.id}`}
                          className="px-3 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600"
                        >
                          Assign
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recent Activity */}
        {analytics && (
          <div className="card">
            <div className="p-5 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
            </div>
            <div className="divide-y divide-gray-50">
              {analytics.recentActivity.length > 0 ? (
                analytics.recentActivity.map((log) => (
                  <div key={log.id} className="px-5 py-3 hover:bg-gray-50 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">
                          {log.action.charAt(0).toUpperCase() + log.action.slice(1)}
                        </span>
                        {log.recipient && (
                          <span className="text-gray-500"> by {log.recipient.name}</span>
                        )}
                      </p>
                      {log.packet && (
                        <p className="text-xs text-gray-500 truncate">{log.packet.name}</p>
                      )}
                      {log.details && (
                        <p className="text-xs text-gray-400 mt-0.5">{log.details}</p>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                      {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-gray-400 text-sm">No recent activity</div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default function Dashboard() {
  return (
    <ProtectedRoute requireAdmin>
      <DashboardContent />
    </ProtectedRoute>
  );
}
