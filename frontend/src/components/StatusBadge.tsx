interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Draft' },
  sent: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Sent' },
  in_progress: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'In Progress' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', label: 'Completed' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-700', label: 'Cancelled' },
  pending: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Pending' },
  notified: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Notified' },
  signed: { bg: 'bg-green-100', text: 'text-green-700', label: 'Signed' },
  skipped: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Skipped' },
};

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config = statusConfig[status] || {
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    label: status,
  };

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${config.bg} ${config.text} ${sizeClasses}`}
    >
      {config.label}
    </span>
  );
}
