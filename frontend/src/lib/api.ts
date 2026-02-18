// API client with authentication support
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Simple fetch wrapper for JSON APIs with credentials
async function api<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    credentials: 'include', // Include cookies for auth
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

// Auth API
export const auth = {
  login: (email: string, password: string) =>
    api<{ user: User }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),

  logout: () => api<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => api<User>('/api/auth/me'),
};

// Packets API
export const packets = {
  list: (params?: { status?: string }) => {
    const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : '';
    return api<Packet[]>(`/api/packets${query}`);
  },

  get: (id: string) => api<Packet>(`/api/packets/${id}`),

  create: async (formData: FormData): Promise<Packet> => {
    const response = await fetch(`${API_URL}/api/packets`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }

    return response.json();
  },

  update: (id: string, data: UpdatePacketData) =>
    api<Packet>(`/api/packets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  delete: (id: string) => api<void>(`/api/packets/${id}`, { method: 'DELETE' }),

  send: (id: string) => api<{ success: boolean }>(`/api/packets/${id}/send`, { method: 'POST' }),

  resend: (id: string) => api<{ success: boolean }>(`/api/packets/${id}/resend`, { method: 'POST' }),

  cancel: (id: string) => api<void>(`/api/packets/${id}/cancel`, { method: 'POST' }),

  timeline: (id: string) => api<AuditLog[]>(`/api/packets/${id}/timeline`),

  getRoles: (id: string) => api<{ roles: string[]; placeholders: Placeholder[] }>(`/api/packets/${id}/roles`),
};

// Signing API (public - uses token auth)
export const signing = {
  getSession: (token: string) => api<SigningSession>(`/api/signing/${token}`),

  submit: (token: string, data: SignatureSubmission) =>
    api<{ success: boolean; completed: boolean; message: string }>(`/api/signing/${token}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  getPdfUrl: (token: string) => `${API_URL}/api/signing/${token}/pdf`,
};

// Admin API
export const admin = {
  stats: () => api<DashboardStats>('/api/admin/stats'),

  downloadUrl: (packetId: string) => `${API_URL}/api/admin/packets/${packetId}/download`,

  auditLogs: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : '';
    return api<AuditLog[]>(`/api/admin/audit-logs${query}`);
  },

  users: () => api<User[]>('/api/admin/users'),
};

// User Documents API (for regular users)
export const userDocs = {
  list: () => api<UserDocument[]>('/api/user/documents'),

  getSignUrl: (id: string) => api<{ signUrl: string }>(`/api/user/documents/${id}/sign-url`),
};

// Types
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
}

export interface UserDocument {
  id: string;
  roleName: string;
  status: string;
  signedAt: string | null;
  packet: {
    id: string;
    name: string;
    fileName: string;
    status: string;
    createdAt: string;
  };
  canSign: boolean;
}

export interface Placeholder {
  type: 'SIGNATURE' | 'DATE' | 'TEXT';
  role: string;
  fieldName?: string;
  originalTag?: string;
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
  userId?: string;
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
  fileName: string;
  filePath: string;
  placeholders: Placeholder[];
  status: 'draft' | 'sent' | 'in_progress' | 'completed' | 'cancelled';
  signedPdfPath: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  recipients: Recipient[];
  roles?: string[];
  auditLogs?: AuditLog[];
}

export interface UpdatePacketData {
  name?: string;
  recipients?: {
    roleName: string;
    name: string;
    email: string;
    order: number;
    userId?: string;
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
  document: {
    fileName: string;
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
