import { Hono } from 'hono';
import { z } from 'zod';
import {
  db, users, signingPackets, recipients, auditLogs, formRoutes,
  eq, and, desc, asc, gte, lte, isNotNull, count, sql,
} from '../db/index.js';
import { requireAdmin } from '../middleware/auth.middleware.js';
import { authService } from '../services/auth.service.js';
import {
  isSharePointConfigured,
  testSharePointConnection,
  refreshFolderCache,
} from '../services/sharepoint.service.js';
import { finalizePacket, uploadPacketToSharePoint, signedFileNameFor } from '../services/completion.service.js';
import { downloadFile } from '../utils/storage.js';

export const adminRoutes = new Hono();

adminRoutes.use('*', requireAdmin);

// GET /users
adminRoutes.get('/users', async (c) => {
  const userList = await db.query.users.findMany({
    columns: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  return c.json(userList);
});

// POST /users — create a new user
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(6),
  role: z.enum(['admin', 'user']).optional(),
});

adminRoutes.post('/users', async (c) => {
  try {
    const body = createUserSchema.parse(await c.req.json());

    const existing = await authService.findUserByEmail(body.email);
    if (existing) {
      return c.json({ error: 'A user with this email already exists' }, 400);
    }

    const user = await authService.createUser({
      email: body.email,
      password: body.password,
      name: body.name,
      role: body.role || 'user',
    });

    return c.json(user, 201);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid input', details: err.errors }, 400);
    }
    console.error('[Admin] Create user error:', err);
    return c.json({ error: 'Failed to create user' }, 500);
  }
});

// PATCH /users/:id — update user role, status, or name
const updateUserSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  isActive: z.boolean().optional(),
  name: z.string().min(1).optional(),
});

adminRoutes.patch('/users/:id', async (c) => {
  try {
    const userId = c.req.param('id');
    const body = updateUserSchema.parse(await c.req.json());
    const currentUser = c.get('currentUser') as { id: string };

    // Prevent admin from deactivating themselves
    if (userId === currentUser.id && body.isActive === false) {
      return c.json({ error: 'You cannot deactivate your own account' }, 400);
    }
    if (userId === currentUser.id && body.role === 'user') {
      return c.json({ error: 'You cannot remove your own admin role' }, 400);
    }

    const existing = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!existing) {
      return c.json({ error: 'User not found' }, 404);
    }

    const updates: Record<string, unknown> = {};
    if (body.role !== undefined) updates.role = body.role;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.name !== undefined) updates.name = body.name;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'No fields to update' }, 400);
    }

    const [updated] = await db.update(users)
      .set(updates)
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
      });

    return c.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid input', details: err.errors }, 400);
    }
    console.error('[Admin] Update user error:', err);
    return c.json({ error: 'Failed to update user' }, 500);
  }
});

// GET /stats
adminRoutes.get('/stats', async (c) => {
  const [packetsByStatus, recentActivity] = await Promise.all([
    db.select({ status: signingPackets.status, _count: count() })
      .from(signingPackets)
      .groupBy(signingPackets.status),
    db.query.auditLogs.findMany({
      orderBy: (a, { desc }) => [desc(a.createdAt)],
      limit: 10,
      with: {
        packet: { columns: { name: true } },
        recipient: { columns: { name: true, email: true } },
      },
    }),
  ]);

  const statusCounts: Record<string, number> = {
    draft: 0, pending_assignment: 0, sent: 0, in_progress: 0, completed: 0, cancelled: 0,
  };
  for (const item of packetsByStatus) {
    statusCounts[item.status] = Number(item._count);
  }

  return c.json({
    packets: statusCounts,
    totalPackets: Object.values(statusCounts).reduce((a, b) => a + b, 0),
    recentActivity,
  });
});

// GET /analytics
adminRoutes.get('/analytics', async (c) => {
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '30', 10) || 30, 1), 365);
  const formRouteId = c.req.query('formRouteId');
  const county = c.req.query('county');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  // Build packet query conditions
  const packetConditions = [gte(signingPackets.createdAt, startDate)];
  if (formRouteId) packetConditions.push(eq(signingPackets.formRouteId, formRouteId));
  if (county) packetConditions.push(sql`${signingPackets.county} LIKE ${'%' + county + '%'}`);

  const [packets, formRouteList, needsAttention, recentActivity, distinctCounties] = await Promise.all([
    db.query.signingPackets.findMany({
      where: and(...packetConditions),
      columns: {
        id: true, name: true, status: true, county: true,
        formRouteId: true, employeeName: true,
        createdAt: true, completedAt: true,
      },
    }),
    db.query.formRoutes.findMany({
      columns: { id: true, formName: true },
    }),
    db.query.signingPackets.findMany({
      where: eq(signingPackets.status, 'pending_assignment'),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
      limit: 25,
      columns: { id: true, name: true, employeeName: true, county: true, formRouteId: true, createdAt: true },
    }),
    db.query.auditLogs.findMany({
      orderBy: (a, { desc }) => [desc(a.createdAt)],
      limit: 20,
      with: {
        packet: { columns: { name: true } },
        recipient: { columns: { name: true, email: true } },
      },
    }),
    db.selectDistinct({ county: signingPackets.county })
      .from(signingPackets)
      .where(isNotNull(signingPackets.county))
      .orderBy(asc(signingPackets.county)),
  ]);

  const routeMap = new Map(formRouteList.map(r => [r.id, r.formName]));
  const statusLabels: Record<string, string> = {
    draft: 'Draft', pending_assignment: 'Unassigned', sent: 'Sent',
    in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled',
  };

  let needsAssignment = 0, inProgress = 0, completed = 0;
  let totalCompletionMs = 0, completionCount = 0;
  const statusCounts: Record<string, number> = {};
  for (const s of Object.keys(statusLabels)) statusCounts[s] = 0;

  const trendMap = new Map<string, { created: number; completed: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    trendMap.set(d.toISOString().split('T')[0], { created: 0, completed: 0 });
  }

  const routeBreakdown = new Map<string | null, Record<string, number>>();
  const countyBreakdown = new Map<string, { count: number; completed: number }>();

  for (const pkt of packets) {
    const s = pkt.status;
    statusCounts[s] = (statusCounts[s] || 0) + 1;
    if (s === 'pending_assignment') needsAssignment++;
    if (s === 'sent' || s === 'in_progress') inProgress++;
    if (s === 'completed') {
      completed++;
      if (pkt.completedAt) {
        totalCompletionMs += new Date(pkt.completedAt).getTime() - new Date(pkt.createdAt).getTime();
        completionCount++;
      }
    }

    const createdDay = new Date(pkt.createdAt).toISOString().split('T')[0];
    const createdBucket = trendMap.get(createdDay);
    if (createdBucket) createdBucket.created++;

    if (pkt.completedAt) {
      const completedDay = new Date(pkt.completedAt).toISOString().split('T')[0];
      const completedBucket = trendMap.get(completedDay);
      if (completedBucket) completedBucket.completed++;
    }

    const routeKey = pkt.formRouteId;
    if (!routeBreakdown.has(routeKey)) {
      routeBreakdown.set(routeKey, { draft: 0, pending_assignment: 0, sent: 0, in_progress: 0, completed: 0, cancelled: 0, total: 0 });
    }
    const rb = routeBreakdown.get(routeKey)!;
    rb[s] = (rb[s] || 0) + 1;
    rb.total++;

    const cty = pkt.county || 'Unknown';
    if (!countyBreakdown.has(cty)) countyBreakdown.set(cty, { count: 0, completed: 0 });
    const cb = countyBreakdown.get(cty)!;
    cb.count++;
    if (s === 'completed') cb.completed++;
  }

  return c.json({
    kpis: {
      totalPackets: packets.length,
      needsAssignment, inProgress, completed,
      avgCompletionHours: completionCount > 0
        ? Math.round((totalCompletionMs / completionCount / (1000 * 60 * 60)) * 10) / 10
        : null,
    },
    statusDistribution: Object.entries(statusCounts)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => ({ status, count, label: statusLabels[status] || status })),
    completionTrend: Array.from(trendMap.entries()).map(([date, data]) => ({ date, ...data })),
    byFormRoute: Array.from(routeBreakdown.entries())
      .map(([routeId, counts]) => ({
        formRouteId: routeId,
        formName: routeId ? (routeMap.get(routeId) || 'Unknown Route') : 'Manual Upload',
        ...counts,
      }))
      .sort((a, b) => (b as any).total - (a as any).total),
    byCounty: Array.from(countyBreakdown.entries())
      .map(([cty, data]) => ({ county: cty, ...data }))
      .sort((a, b) => b.count - a.count),
    needsAttention: needsAttention.map(pkt => ({
      ...pkt,
      formName: pkt.formRouteId ? (routeMap.get(pkt.formRouteId) || null) : null,
    })),
    recentActivity,
    filterOptions: {
      formRoutes: formRouteList.map(r => ({ id: r.id, formName: r.formName })),
      counties: distinctCounties.map(c => c.county).filter(Boolean) as string[],
    },
  });
});

// Preview original PDF
adminRoutes.get('/packets/:packetId/preview', async (c) => {
  const packet = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, c.req.param('packetId')),
  });
  if (!packet) return c.json({ error: 'Packet not found' }, 404);

  try {
    const pdfBuffer = await downloadFile(packet.filePath);
    return new Response(pdfBuffer, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline' },
    });
  } catch {
    return c.json({ error: 'PDF file not found' }, 404);
  }
});

// Download signed PDF
adminRoutes.get('/packets/:packetId/download', async (c) => {
  const packet = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, c.req.param('packetId')),
  });
  if (!packet) return c.json({ error: 'Packet not found' }, 404);

  if (packet.status !== 'completed' || !packet.signedPdfPath) {
    return c.json({ error: 'Signed PDF not available' }, 400);
  }

  try {
    const pdfBuffer = await downloadFile(packet.signedPdfPath);
    const fileName = signedFileNameFor(packet.name).replace(/[^a-zA-Z0-9._-]/g, '_');
    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch {
    return c.json({ error: 'PDF file not found' }, 404);
  }
});

// Retry generating the signed PDF for a packet whose signers are all done
adminRoutes.post('/packets/:packetId/finalize', async (c) => {
  const packet = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, c.req.param('packetId')),
  });
  if (!packet) return c.json({ error: 'Packet not found' }, 404);
  if (packet.status === 'completed') return c.json({ error: 'Packet is already completed' }, 400);

  try {
    const result = await finalizePacket(packet.id);
    return c.json({ success: true, ...result });
  } catch (err) {
    return c.json({ error: `Finalization failed: ${err instanceof Error ? err.message : String(err)}` }, 400);
  }
});

// Audit log search
adminRoutes.get('/audit-logs', async (c) => {
  const packetId = c.req.query('packetId');
  const action = c.req.query('action');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const limit = c.req.query('limit') || '100';

  const conditions = [];
  if (packetId) conditions.push(eq(auditLogs.packetId, packetId));
  if (action) conditions.push(eq(auditLogs.action, action));
  if (from) conditions.push(gte(auditLogs.createdAt, new Date(from)));
  if (to) conditions.push(lte(auditLogs.createdAt, new Date(to)));

  const logs = await db.query.auditLogs.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: (a, { desc }) => [desc(a.createdAt)],
    limit: parseInt(limit, 10),
    with: {
      packet: { columns: { id: true, name: true } },
      recipient: { columns: { name: true, email: true, roleName: true } },
    },
  });

  return c.json(logs);
});

// Recipient details
adminRoutes.get('/recipients/:recipientId', async (c) => {
  const recipient = await db.query.recipients.findFirst({
    where: eq(recipients.id, c.req.param('recipientId')),
    with: {
      packet: { columns: { id: true, name: true, status: true } },
      signature: {
        columns: { id: true, signatureType: true, typedName: true, ipAddress: true, userAgent: true, createdAt: true },
      },
      auditLogs: {
        orderBy: (a, { desc }) => [desc(a.createdAt)],
      },
    },
  });

  if (!recipient) return c.json({ error: 'Recipient not found' }, 404);
  return c.json(recipient);
});

// --- SharePoint Admin Routes ---

adminRoutes.get('/sharepoint/status', async (c) => {
  const configured = isSharePointConfigured();
  if (!configured) {
    return c.json({
      configured: false, connected: false,
      message: 'SharePoint integration is not configured. Set SHAREPOINT_ENABLED=true and provide Microsoft credentials.',
    });
  }

  try {
    const connectionTest = await testSharePointConnection();
    return c.json({ configured: true, ...connectionTest });
  } catch (err) {
    return c.json({ configured: true, connected: false, error: err instanceof Error ? err.message : String(err) });
  }
});

adminRoutes.post('/sharepoint/retry/:packetId', async (c) => {
  if (!isSharePointConfigured()) {
    return c.json({ error: 'SharePoint integration is not configured' }, 400);
  }

  const packet = await db.query.signingPackets.findFirst({
    where: eq(signingPackets.id, c.req.param('packetId')),
  });
  if (!packet) return c.json({ error: 'Packet not found' }, 404);

  if (packet.status !== 'completed' || !packet.signedPdfPath) {
    return c.json({ error: 'Packet must be completed with a signed PDF' }, 400);
  }

  if (packet.sharepointUrl) {
    return c.json({ error: 'Already uploaded to SharePoint', url: packet.sharepointUrl }, 400);
  }

  try {
    const result = await uploadPacketToSharePoint(packet.id, undefined, 'Retry: ');
    return c.json({ success: true, url: result.url, folderName: result.folderName, matchInfo: result.matchInfo });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `SharePoint upload failed: ${errorMsg}` }, 500);
  }
});

adminRoutes.post('/sharepoint/retry-all', async (c) => {
  if (!isSharePointConfigured()) {
    return c.json({ error: 'SharePoint integration is not configured' }, 400);
  }

  const failedPackets = await db.query.signingPackets.findMany({
    where: and(
      eq(signingPackets.status, 'completed'),
      isNotNull(signingPackets.signedPdfPath),
      sql`${signingPackets.sharepointUrl} IS NULL`
    ),
    columns: { id: true, name: true },
  });

  if (failedPackets.length === 0) {
    return c.json({ success: true, retried: 0, message: 'No failed uploads to retry' });
  }

  let succeeded = 0, failed = 0;
  const errors: string[] = [];

  for (const pkt of failedPackets) {
    try {
      await uploadPacketToSharePoint(pkt.id, undefined, 'Bulk retry: ');
      succeeded++;
    } catch (err) {
      failed++;
      errors.push(`${pkt.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return c.json({ success: true, total: failedPackets.length, succeeded, failed, errors });
});

adminRoutes.post('/sharepoint/refresh-cache', async (c) => {
  if (!isSharePointConfigured()) {
    return c.json({ error: 'SharePoint integration is not configured' }, 400);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const subfolder = (body as any)?.subfolder || null;
    const folderCount = await refreshFolderCache(subfolder);
    return c.json({ success: true, folderCount });
  } catch (err) {
    return c.json({ error: `Failed to refresh cache: ${err instanceof Error ? err.message : String(err)}` }, 500);
  }
});

adminRoutes.get('/sharepoint/failed', async (c) => {
  const failedPackets = await db.query.signingPackets.findMany({
    where: and(
      eq(signingPackets.status, 'completed'),
      isNotNull(signingPackets.signedPdfPath),
      sql`${signingPackets.sharepointUrl} IS NULL`
    ),
    columns: { id: true, name: true, employeeName: true, sharepointError: true, completedAt: true, formRouteId: true },
    orderBy: (t, { desc }) => [desc(t.completedAt)],
  });
  return c.json({ count: failedPackets.length, packets: failedPackets });
});

// System health check
adminRoutes.get('/health', async (c) => {
  const dbCheck = await db.execute(sql`SELECT 1 as ok`);

  return c.json({
    status: 'ok',
    database: !!dbCheck,
    storage: { type: 'object-storage' },
    timestamp: new Date().toISOString(),
  });
});
