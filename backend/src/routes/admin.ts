import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { requireAdmin } from '../middleware/auth.middleware.js';
import {
  isSharePointConfigured,
  testSharePointConnection,
  uploadToSharePoint,
  refreshFolderCache,
} from '../services/sharepoint.service.js';
import fs from 'fs/promises';
import path from 'path';

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // Protect all admin routes
  fastify.addHook('preHandler', requireAdmin);

  // GET /users - list all users
  fastify.get('/users', async () => {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, isActive: true },
      orderBy: { name: 'asc' },
    });
    return users;
  });

  // Dashboard stats
  fastify.get('/stats', async (request, reply) => {
    const [
      packetsByStatus,
      recentActivity,
    ] = await Promise.all([
      prisma.signingPacket.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          packet: { select: { name: true } },
          recipient: { select: { name: true, email: true } },
        },
      }),
    ]);

    const statusCounts: Record<string, number> = {
      draft: 0,
      pending_assignment: 0,
      sent: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
    };

    for (const item of packetsByStatus) {
      statusCounts[item.status] = item._count;
    }

    return {
      packets: statusCounts,
      totalPackets: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      recentActivity,
    };
  });

  // Analytics endpoint for dashboard charts and KPIs
  fastify.get<{
    Querystring: { days?: string; formRouteId?: string; county?: string };
  }>('/analytics', async (request) => {
    const days = Math.min(Math.max(parseInt(request.query.days || '30', 10) || 30, 1), 365);
    const { formRouteId, county } = request.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Run all queries in parallel
    const [packets, formRoutes, needsAttention, recentActivity, distinctCounties] = await Promise.all([
      // 1. All packets in date range (with filters)
      prisma.signingPacket.findMany({
        where: {
          createdAt: { gte: startDate },
          ...(formRouteId ? { formRouteId } : {}),
          ...(county ? { county: { contains: county } } : {}),
        },
        select: {
          id: true, name: true, status: true, county: true,
          formRouteId: true, employeeName: true,
          createdAt: true, completedAt: true,
        },
      }),
      // 2. All form routes for name lookup
      prisma.formRoute.findMany({
        select: { id: true, formName: true },
      }),
      // 3. Unassigned packets for "needs attention"
      prisma.signingPacket.findMany({
        where: { status: 'pending_assignment' },
        orderBy: { createdAt: 'asc' },
        take: 25,
        select: {
          id: true, name: true, employeeName: true,
          county: true, formRouteId: true, createdAt: true,
        },
      }),
      // 4. Recent activity
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          packet: { select: { name: true } },
          recipient: { select: { name: true, email: true } },
        },
      }),
      // 5. Distinct counties
      prisma.signingPacket.findMany({
        where: { county: { not: null } },
        select: { county: true },
        distinct: ['county'],
        orderBy: { county: 'asc' },
      }),
    ]);

    // Build form route lookup
    const routeMap = new Map(formRoutes.map(r => [r.id, r.formName]));

    // --- KPIs ---
    const statusLabels: Record<string, string> = {
      draft: 'Draft',
      pending_assignment: 'Unassigned',
      sent: 'Sent',
      in_progress: 'In Progress',
      completed: 'Completed',
      cancelled: 'Cancelled',
    };

    let needsAssignment = 0;
    let inProgress = 0;
    let completed = 0;
    let totalCompletionMs = 0;
    let completionCount = 0;

    const statusCounts: Record<string, number> = {};
    for (const s of Object.keys(statusLabels)) statusCounts[s] = 0;

    // --- Trend buckets ---
    const trendMap = new Map<string, { created: number; completed: number }>();
    // Pre-fill all days
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      const key = d.toISOString().split('T')[0];
      trendMap.set(key, { created: 0, completed: 0 });
    }

    // --- By form route ---
    const routeBreakdown = new Map<string | null, Record<string, number>>();
    // --- By county ---
    const countyBreakdown = new Map<string, { count: number; completed: number }>();

    // Single pass over packets
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

      // Trend: created
      const createdDay = new Date(pkt.createdAt).toISOString().split('T')[0];
      const createdBucket = trendMap.get(createdDay);
      if (createdBucket) createdBucket.created++;

      // Trend: completed
      if (pkt.completedAt) {
        const completedDay = new Date(pkt.completedAt).toISOString().split('T')[0];
        const completedBucket = trendMap.get(completedDay);
        if (completedBucket) completedBucket.completed++;
      }

      // By form route
      const routeKey = pkt.formRouteId;
      if (!routeBreakdown.has(routeKey)) {
        routeBreakdown.set(routeKey, { draft: 0, pending_assignment: 0, sent: 0, in_progress: 0, completed: 0, cancelled: 0, total: 0 });
      }
      const rb = routeBreakdown.get(routeKey)!;
      rb[s] = (rb[s] || 0) + 1;
      rb.total++;

      // By county
      const c = pkt.county || 'Unknown';
      if (!countyBreakdown.has(c)) {
        countyBreakdown.set(c, { count: 0, completed: 0 });
      }
      const cb = countyBreakdown.get(c)!;
      cb.count++;
      if (s === 'completed') cb.completed++;
    }

    // Build response
    const statusDistribution = Object.entries(statusCounts)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => ({
        status,
        count,
        label: statusLabels[status] || status,
      }));

    const completionTrend = Array.from(trendMap.entries()).map(([date, data]) => ({
      date,
      created: data.created,
      completed: data.completed,
    }));

    const byFormRoute = Array.from(routeBreakdown.entries())
      .map(([routeId, counts]) => ({
        formRouteId: routeId,
        formName: routeId ? (routeMap.get(routeId) || 'Unknown Route') : 'Manual Upload',
        ...counts,
      }))
      .sort((a, b) => (b as any).total - (a as any).total);

    const byCounty = Array.from(countyBreakdown.entries())
      .map(([cty, data]) => ({
        county: cty,
        count: data.count,
        completed: data.completed,
      }))
      .sort((a, b) => b.count - a.count);

    const needsAttentionWithFormName = needsAttention.map(pkt => ({
      ...pkt,
      formName: pkt.formRouteId ? (routeMap.get(pkt.formRouteId) || null) : null,
    }));

    return {
      kpis: {
        totalPackets: packets.length,
        needsAssignment,
        inProgress,
        completed,
        avgCompletionHours: completionCount > 0
          ? Math.round((totalCompletionMs / completionCount / (1000 * 60 * 60)) * 10) / 10
          : null,
      },
      statusDistribution,
      completionTrend,
      byFormRoute,
      byCounty,
      needsAttention: needsAttentionWithFormName,
      recentActivity,
      filterOptions: {
        formRoutes: formRoutes.map(r => ({ id: r.id, formName: r.formName })),
        counties: distinctCounties.map(c => c.county).filter(Boolean) as string[],
      },
    };
  });

  // Preview original PDF (inline)
  fastify.get<{ Params: { packetId: string } }>(
    '/packets/:packetId/preview',
    async (request, reply) => {
      const { packetId } = request.params;

      const packet = await prisma.signingPacket.findUnique({
        where: { id: packetId },
      });

      if (!packet) {
        return reply.status(404).send({ error: 'Packet not found' });
      }

      try {
        const filePath = path.join(process.cwd(), 'uploads', packet.filePath);
        const pdfBuffer = await fs.readFile(filePath);

        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', 'inline')
          .send(pdfBuffer);
      } catch (err) {
        return reply.status(404).send({ error: 'PDF file not found' });
      }
    }
  );

  // Download signed PDF
  fastify.get<{ Params: { packetId: string } }>(
    '/packets/:packetId/download',
    async (request, reply) => {
      const { packetId } = request.params;

      const packet = await prisma.signingPacket.findUnique({
        where: { id: packetId },
      });

      if (!packet) {
        return reply.status(404).send({ error: 'Packet not found' });
      }

      if (packet.status !== 'completed' || !packet.signedPdfPath) {
        return reply.status(400).send({ error: 'Signed PDF not available' });
      }

      try {
        const pdfBuffer = await fs.readFile(packet.signedPdfPath);
        const fileName = `${packet.name.replace(/[^a-zA-Z0-9]/g, '_')}_signed.pdf`;

        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `attachment; filename="${fileName}"`)
          .send(pdfBuffer);
      } catch (err) {
        return reply.status(404).send({ error: 'PDF file not found' });
      }
    }
  );

  // Audit log search
  fastify.get<{
    Querystring: {
      packetId?: string;
      action?: string;
      from?: string;
      to?: string;
      limit?: string;
    };
  }>('/audit-logs', async (request, reply) => {
    const { packetId, action, from, to, limit = '100' } = request.query;

    const logs = await prisma.auditLog.findMany({
      where: {
        ...(packetId && { packetId }),
        ...(action && { action }),
        ...(from && { createdAt: { gte: new Date(from) } }),
        ...(to && { createdAt: { lte: new Date(to) } }),
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
      include: {
        packet: { select: { id: true, name: true } },
        recipient: { select: { name: true, email: true, roleName: true } },
      },
    });

    return logs;
  });

  // Recipient details with signature info
  fastify.get<{ Params: { recipientId: string } }>(
    '/recipients/:recipientId',
    async (request, reply) => {
      const { recipientId } = request.params;

      const recipient = await prisma.recipient.findUnique({
        where: { id: recipientId },
        include: {
          packet: {
            select: { id: true, name: true, status: true },
          },
          signature: {
            select: {
              id: true,
              signatureType: true,
              typedName: true,
              ipAddress: true,
              userAgent: true,
              createdAt: true,
            },
          },
          auditLogs: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!recipient) {
        return reply.status(404).send({ error: 'Recipient not found' });
      }

      return recipient;
    }
  );

  // --- SharePoint Admin Routes ---

  // GET /sharepoint/status - Check SharePoint configuration and connection
  fastify.get('/sharepoint/status', async (request, reply) => {
    const configured = isSharePointConfigured();

    if (!configured) {
      return {
        configured: false,
        connected: false,
        message: 'SharePoint integration is not configured. Set SHAREPOINT_ENABLED=true and provide Microsoft credentials.',
      };
    }

    try {
      const connectionTest = await testSharePointConnection();
      return {
        configured: true,
        ...connectionTest,
      };
    } catch (err) {
      return {
        configured: true,
        connected: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // POST /sharepoint/retry/:packetId - Retry a failed SharePoint upload
  fastify.post<{ Params: { packetId: string } }>(
    '/sharepoint/retry/:packetId',
    async (request, reply) => {
      if (!isSharePointConfigured()) {
        return reply.status(400).send({ error: 'SharePoint integration is not configured' });
      }

      const packet = await prisma.signingPacket.findUnique({
        where: { id: request.params.packetId },
      });

      if (!packet) {
        return reply.status(404).send({ error: 'Packet not found' });
      }

      if (packet.status !== 'completed' || !packet.signedPdfPath) {
        return reply.status(400).send({ error: 'Packet must be completed with a signed PDF' });
      }

      if (packet.sharepointUrl) {
        return reply.status(400).send({
          error: 'Already uploaded to SharePoint',
          url: packet.sharepointUrl,
        });
      }

      try {
        const pdfBuffer = await fs.readFile(packet.signedPdfPath);
        const employeeName = packet.employeeName || packet.name;
        const signedFileName = `${packet.name.replace(/[^a-zA-Z0-9]/g, '_')}_signed.pdf`;

        // Get optional subfolder from form route
        let subfolder: string | null = null;
        if (packet.formRouteId) {
          const formRoute = await prisma.formRoute.findUnique({
            where: { id: packet.formRouteId },
          });
          subfolder = formRoute?.sharepointFolder || null;
        }

        const uploadResult = await uploadToSharePoint(
          employeeName,
          signedFileName,
          pdfBuffer,
          subfolder
        );

        await prisma.signingPacket.update({
          where: { id: packet.id },
          data: {
            sharepointUrl: uploadResult.url,
            sharepointFolder: uploadResult.folderName,
            sharepointError: null,
          },
        });

        const matchInfo = uploadResult.isExistingFolder
          ? `matched existing folder "${uploadResult.folderName}" (${Math.round(uploadResult.matchConfidence * 100)}% confidence)`
          : `created new folder "${uploadResult.folderName}"`;

        await prisma.auditLog.create({
          data: {
            packetId: packet.id,
            action: 'uploaded',
            details: `Retry: Signed PDF uploaded to SharePoint: ${uploadResult.url} — ${matchInfo}`,
          },
        });

        return {
          success: true,
          url: uploadResult.url,
          folderName: uploadResult.folderName,
          matchInfo,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        await prisma.signingPacket.update({
          where: { id: packet.id },
          data: { sharepointError: errorMsg },
        }).catch(() => {});

        await prisma.auditLog.create({
          data: {
            packetId: packet.id,
            action: 'upload_failed',
            details: `Retry failed: ${errorMsg}`,
          },
        }).catch(() => {});

        return reply.status(500).send({ error: `SharePoint upload failed: ${errorMsg}` });
      }
    }
  );

  // POST /sharepoint/retry-all - Retry all failed SharePoint uploads
  fastify.post('/sharepoint/retry-all', async (request, reply) => {
    if (!isSharePointConfigured()) {
      return reply.status(400).send({ error: 'SharePoint integration is not configured' });
    }

    const failedPackets = await prisma.signingPacket.findMany({
      where: {
        status: 'completed',
        signedPdfPath: { not: null },
        sharepointUrl: null,
      },
      select: { id: true, name: true },
    });

    if (failedPackets.length === 0) {
      return { success: true, retried: 0, message: 'No failed uploads to retry' };
    }

    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const pkt of failedPackets) {
      try {
        // Call the retry route logic inline
        const packet = await prisma.signingPacket.findUnique({ where: { id: pkt.id } });
        if (!packet || !packet.signedPdfPath) continue;

        const pdfBuffer = await fs.readFile(packet.signedPdfPath);
        const employeeName = packet.employeeName || packet.name;
        const signedFileName = `${packet.name.replace(/[^a-zA-Z0-9]/g, '_')}_signed.pdf`;

        let subfolder: string | null = null;
        if (packet.formRouteId) {
          const formRoute = await prisma.formRoute.findUnique({ where: { id: packet.formRouteId } });
          subfolder = formRoute?.sharepointFolder || null;
        }

        const uploadResult = await uploadToSharePoint(employeeName, signedFileName, pdfBuffer, subfolder);

        await prisma.signingPacket.update({
          where: { id: packet.id },
          data: {
            sharepointUrl: uploadResult.url,
            sharepointFolder: uploadResult.folderName,
            sharepointError: null,
          },
        });

        await prisma.auditLog.create({
          data: {
            packetId: packet.id,
            action: 'uploaded',
            details: `Bulk retry: Uploaded to SharePoint: ${uploadResult.url}`,
          },
        });

        succeeded++;
      } catch (err) {
        failed++;
        errors.push(`${pkt.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { success: true, total: failedPackets.length, succeeded, failed, errors };
  });

  // POST /sharepoint/refresh-cache - Force refresh the folder cache
  fastify.post<{ Body: { subfolder?: string } }>(
    '/sharepoint/refresh-cache',
    async (request, reply) => {
      if (!isSharePointConfigured()) {
        return reply.status(400).send({ error: 'SharePoint integration is not configured' });
      }

      try {
        const subfolder = (request.body as any)?.subfolder || null;
        const folderCount = await refreshFolderCache(subfolder);
        return { success: true, folderCount };
      } catch (err) {
        return reply.status(500).send({
          error: `Failed to refresh cache: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  );

  // GET /sharepoint/failed - List packets with failed SharePoint uploads
  fastify.get('/sharepoint/failed', async () => {
    const failedPackets = await prisma.signingPacket.findMany({
      where: {
        status: 'completed',
        signedPdfPath: { not: null },
        sharepointUrl: null,
      },
      select: {
        id: true,
        name: true,
        employeeName: true,
        sharepointError: true,
        completedAt: true,
        formRouteId: true,
      },
      orderBy: { completedAt: 'desc' },
    });

    return { count: failedPackets.length, packets: failedPackets };
  });

  // System health check
  fastify.get('/health', async (request, reply) => {
    const dbCheck = await prisma.$queryRaw`SELECT 1 as ok`;

    const uploadsDir = path.join(process.cwd(), 'uploads');
    const signedDir = path.join(process.cwd(), 'signed');

    let uploadsWritable = false;
    let signedWritable = false;

    try {
      await fs.access(uploadsDir, fs.constants.W_OK);
      uploadsWritable = true;
    } catch {}

    try {
      await fs.access(signedDir, fs.constants.W_OK);
      signedWritable = true;
    } catch {}

    return {
      status: 'ok',
      database: !!dbCheck,
      storage: {
        uploads: uploadsWritable,
        signed: signedWritable,
      },
      timestamp: new Date().toISOString(),
    };
  });
};
