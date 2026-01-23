const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface FetchOptions extends RequestInit {
  data?: unknown;
}

async function fetchApi<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { data, ...fetchOptions } = options;

  const config: RequestInit = {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    },
  };

  if (data) {
    config.body = JSON.stringify(data);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, config);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

// Templates
export const templates = {
  list: () => fetchApi<Template[]>('/api/templates'),
  get: (id: string) => fetchApi<Template>(`/api/templates/${id}`),
  upload: async (formData: FormData) => {
    const response = await fetch(`${API_BASE}/api/templates`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }
    return response.json();
  },
  delete: (id: string) => fetchApi(`/api/templates/${id}`, { method: 'DELETE' }),
  getRoles: (id: string) => fetchApi<{ roles: string[]; placeholders: Placeholder[] }>(`/api/templates/${id}/roles`),
};

// Packets
export const packets = {
  list: (params?: { status?: string; templateId?: string }) => {
    const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : '';
    return fetchApi<Packet[]>(`/api/packets${query}`);
  },
  get: (id: string) => fetchApi<Packet>(`/api/packets/${id}`),
  create: (data: CreatePacketData) => fetchApi<Packet>('/api/packets', { method: 'POST', data }),
  update: (id: string, data: Partial<CreatePacketData>) =>
    fetchApi<Packet>(`/api/packets/${id}`, { method: 'PATCH', data }),
  delete: (id: string) => fetchApi(`/api/packets/${id}`, { method: 'DELETE' }),
  send: (id: string) => fetchApi(`/api/packets/${id}/send`, { method: 'POST' }),
  resend: (id: string) => fetchApi(`/api/packets/${id}/resend`, { method: 'POST' }),
  cancel: (id: string) => fetchApi(`/api/packets/${id}/cancel`, { method: 'POST' }),
  timeline: (id: string) => fetchApi<AuditLog[]>(`/api/packets/${id}/timeline`),
};

// Signing
export const signing = {
  getSession: (token: string) => fetchApi<SigningSession>(`/api/signing/${token}`),
  submit: (token: string, data: SignatureSubmission) =>
    fetchApi<{ success: boolean; completed: boolean; message: string }>(
      `/api/signing/${token}/sign`,
      { method: 'POST', data }
    ),
  getPdfUrl: (token: string) => `${API_BASE}/api/signing/${token}/pdf`,
};

// Admin
export const admin = {
  stats: () => fetchApi<DashboardStats>('/api/admin/stats'),
  downloadUrl: (packetId: string) => `${API_BASE}/api/admin/packets/${packetId}/download`,
  auditLogs: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : '';
    return fetchApi<AuditLog[]>(`/api/admin/audit-logs${query}`);
  },
};

// Types
export interface Template {
  id: string;
  name: string;
  description: string | null;
  fileName: string;
  filePath: string;
  placeholders: Placeholder[];
  createdAt: string;
  updatedAt: string;
  packetCount?: number;
}

export interface Placeholder {
  type: 'SIGNATURE' | 'DATE' | 'TEXT';
  role: string;
  fieldName?: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Recipient {
  id: string;
  roleName: string;
  name: string;
  email: string;
  order: number;
  status: 'pending' | 'notified' | 'signed' | 'skipped';
  signedAt: string | null;
  signature?: {
    id: string;
    signatureType: string;
    typedName: string;
    createdAt: string;
  };
}

export interface Packet {
  id: string;
  name: string;
  templateId: string;
  template: {
    id: string;
    name: string;
    placeholders?: Placeholder[];
  };
  status: 'draft' | 'sent' | 'in_progress' | 'completed' | 'cancelled';
  signedPdfPath: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  recipients: Recipient[];
  auditLogs?: AuditLog[];
}

export interface CreatePacketData {
  name: string;
  templateId: string;
  recipients: {
    roleName: string;
    name: string;
    email: string;
    order: number;
  }[];
}

export interface AuditLog {
  id: string;
  packetId: string;
  recipientId: string | null;
  action: string;
  details: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  packet?: { id: string; name: string };
  recipient?: { name: string; email: string; roleName: string };
}

export interface DashboardStats {
  templates: number;
  packets: {
    draft: number;
    sent: number;
    in_progress: number;
    completed: number;
    cancelled: number;
  };
  totalPackets: number;
  recentActivity: AuditLog[];
}

export interface SigningSession {
  recipient: {
    id: string;
    name: string;
    email: string;
    roleName: string;
  };
  packet: {
    id: string;
    name: string;
    status: string;
  };
  template: {
    id: string;
    name: string;
    filePath: string;
  };
  placeholders: Placeholder[];
  signers: {
    roleName: string;
    name: string;
    order: number;
    status: string;
    isCurrentUser: boolean;
  }[];
}

export interface SignatureSubmission {
  signatureData: string;
  signatureType: 'drawn' | 'typed';
  typedName: string;
  textFields?: Record<string, string>;
  confirmed: boolean;
}
