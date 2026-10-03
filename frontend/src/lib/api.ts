// API client with authentication support
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
  list: (params?: { status?: string; county?: string; formRouteId?: string }) => {
    const filtered = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v)) : {};
    const query = Object.keys(filtered).length ? `?${new URLSearchParams(filtered as Record<string, string>)}` : '';
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

  reassign: (packetId: string, recipientId: string, data: { name: string; email: string }) =>
    api<{ success: boolean; message: string }>(`/api/packets/${packetId}/recipients/${recipientId}/reassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  bulkAssign: (data: { packetIds: string[]; signerName: string; signerEmail: string; signerRole?: string }) =>
    api<{ success: boolean; assigned: number; total: number; errors: string[] }>('/api/packets/bulk-assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
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

  getConfirmation: (token: string) => api<SigningConfirmation>(`/api/signing/${token}/confirmation`),

  getPdfUrl: (token: string) => `${API_URL}/api/signing/${token}/pdf`,
};

// Admin API
export const admin = {
  stats: () => api<DashboardStats>('/api/admin/stats'),

  analytics: (params?: { days?: number; formRouteId?: string; county?: string }) => {
    const entries = params
      ? Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])
      : [];
    const query = entries.length ? `?${new URLSearchParams(entries)}` : '';
    return api<AnalyticsResponse>(`/api/admin/analytics${query}`);
  },

  downloadUrl: (packetId: string) => `${API_URL}/api/admin/packets/${packetId}/download`,
  previewUrl: (packetId: string) => `${API_URL}/api/admin/packets/${packetId}/preview`,

  auditLogs: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : '';
    return api<AuditLog[]>(`/api/admin/audit-logs${query}`);
  },

  users: () => api<AdminUser[]>('/api/admin/users'),

  createUser: (data: { email: string; name: string; password: string; role?: 'admin' | 'user' }) =>
    api<AdminUser>('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  updateUser: (id: string, data: { role?: 'admin' | 'user'; isActive?: boolean; name?: string }) =>
    api<AdminUser>(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  // Form Routes
  formRoutes: {
    list: () => api<FormRoute[]>('/api/admin/form-routes'),

    get: (id: string) => api<FormRoute>(`/api/admin/form-routes/${id}`),

    create: (data: CreateFormRouteData) =>
      api<FormRoute>('/api/admin/form-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),

    update: (id: string, data: Partial<CreateFormRouteData>) =>
      api<FormRoute>(`/api/admin/form-routes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      api<{ success: boolean }>(`/api/admin/form-routes/${id}`, { method: 'DELETE' }),

    pull: (id: string, days: number = 7) =>
      api<PullResult>(`/api/admin/form-routes/${id}/pull?days=${days}`, { method: 'POST' }),
  },

  // SharePoint
  finalize: (packetId: string) =>
    api<{ success: boolean; signedPdfPath: string; pdfHash: string }>(`/api/admin/packets/${packetId}/finalize`, { method: 'POST' }),

  sharepoint: {
    status: () => api<{
      configured: boolean;
      connected?: boolean;
      authenticated?: boolean;
      driveFound?: boolean;
      baseFolderAccessible?: boolean;
      folderCount?: number;
      error?: string;
      message?: string;
    }>('/api/admin/sharepoint/status'),

    retry: (packetId: string) => api<{
      success: boolean;
      url: string;
      folderName: string;
      matchInfo: string;
    }>(`/api/admin/sharepoint/retry/${packetId}`, { method: 'POST' }),

    retryAll: () => api<{
      success: boolean;
      total: number;
      succeeded: number;
      failed: number;
      errors: string[];
    }>('/api/admin/sharepoint/retry-all', { method: 'POST' }),

    failed: () => api<{
      count: number;
      packets: {
        id: string;
        name: string;
        employeeName: string | null;
        sharepointError: string | null;
        completedAt: string | null;
        formRouteId: string | null;
      }[];
    }>('/api/admin/sharepoint/failed'),

    refreshCache: (subfolder?: string) =>
      api<{ success: boolean; folderCount: number }>('/api/admin/sharepoint/refresh-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subfolder }),
      }),
  },

  // Google Drive
  google: {
    status: () => api<{ connected: boolean; configured: boolean }>('/api/admin/google/status'),

    authUrl: () => api<{ url: string }>('/api/admin/google/auth-url'),
  },
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

export interface AdminUser extends User {
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
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
  /** Field box in PDF user space (origin bottom-left) */
  x: number;
  y: number;
  width: number;
  height: number;
  tagBox?: { x: number; y: number; width: number; height: number };
  fontSize?: number;
  /** Filled automatically from the signer's identity / signing date */
  autoFill?: 'name' | 'email' | 'initials' | 'date';
  required?: boolean;
  /** Page MediaBox [x0, y0, x1, y1] */
  pageView?: [number, number, number, number];
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
  status: 'draft' | 'pending_assignment' | 'sent' | 'in_progress' | 'completed' | 'cancelled';
  signedPdfPath: string | null;
  sharepointUrl?: string | null;
  sharepointFolder?: string | null;
  sharepointError?: string | null;
  employeeName?: string | null;
  employeeEmail?: string | null;
  county?: string | null;
  formRouteId?: string | null;
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
    pending_assignment: number;
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
  attestationAcknowledged: boolean;
  attestationText: string;
}

export interface SigningConfirmation {
  confirmationId: string;
  signer: {
    name: string;
    email: string;
    role: string;
  };
  document: {
    name: string;
    fileName: string;
  };
  signature: {
    type: string;
    typedName: string;
    signedAt: string;
  };
  attestation: {
    text: string;
    acknowledgedAt: string;
  };
  identity: {
    ip: string;
    userAgent: string;
    signedAt: string;
  };
}

export interface FormRoute {
  id: string;
  jotformFormId: string;
  formName: string;
  signerEmail: string | null;
  signerName: string | null;
  signerRole: string;
  driveFolderId: string | null;
  sharepointFolder: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PullResult {
  success: boolean;
  total: number;
  created: number;
  skipped: number;
  errors: string[];
}

export interface CreateFormRouteData {
  jotformFormId: string;
  formName: string;
  signerEmail?: string;
  signerName?: string;
  signerRole?: string;
  driveFolderId?: string;
  sharepointFolder?: string;
  isActive?: boolean;
}

// Analytics types
export interface AnalyticsResponse {
  kpis: {
    totalPackets: number;
    needsAssignment: number;
    inProgress: number;
    completed: number;
    avgCompletionHours: number | null;
  };
  statusDistribution: { status: string; count: number; label: string }[];
  completionTrend: { date: string; created: number; completed: number }[];
  byFormRoute: {
    formRouteId: string | null;
    formName: string;
    draft: number;
    pending_assignment: number;
    sent: number;
    in_progress: number;
    completed: number;
    cancelled: number;
    total: number;
  }[];
  byCounty: { county: string; count: number; completed: number }[];
  needsAttention: {
    id: string;
    name: string;
    employeeName: string | null;
    county: string | null;
    formRouteId: string | null;
    formName: string | null;
    createdAt: string;
  }[];
  recentActivity: AuditLog[];
  filterOptions: {
    formRoutes: { id: string; formName: string }[];
    counties: string[];
  };
}
