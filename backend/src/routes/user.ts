import { Hono } from 'hono';
import { db, recipients, eq, and } from '../db/index.js';
import { requireAuth } from '../middleware/auth.middleware.js';

export const userRoutes = new Hono();

userRoutes.use('*', requireAuth);

// GET /documents
userRoutes.get('/documents', async (c) => {
  const currentUser = c.get('currentUser');

  const recs = await db.query.recipients.findMany({
    where: eq(recipients.email, currentUser.email),
    with: {
      packet: {
        columns: { id: true, name: true, fileName: true, status: true, createdAt: true },
      },
    },
  });

  // Sort by packet.createdAt desc (Drizzle relational queries don't support ordering by relation fields)
  recs.sort((a, b) => new Date(b.packet.createdAt).getTime() - new Date(a.packet.createdAt).getTime());

  return c.json(recs.map((r) => ({
    id: r.id,
    roleName: r.roleName,
    status: r.status,
    signedAt: r.signedAt,
    packet: r.packet,
    canSign: r.status === 'notified' || r.status === 'pending',
  })));
});

// GET /documents/:id/sign-url
userRoutes.get('/documents/:id/sign-url', async (c) => {
  const currentUser = c.get('currentUser');
  const id = c.req.param('id');

  const recipient = await db.query.recipients.findFirst({
    where: and(eq(recipients.id, id), eq(recipients.email, currentUser.email)),
  });

  if (!recipient) {
    return c.json({ error: 'Document not found' }, 404);
  }

  if (recipient.status === 'signed') {
    return c.json({ error: 'Already signed' }, 400);
  }

  return c.json({ signUrl: `/sign/${recipient.token}` });
});
