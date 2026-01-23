import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { parseTemplatePlaceholders, getUniqueRoles } from '../services/pdf.service.js';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export const templateRoutes: FastifyPluginAsync = async (fastify) => {
  // List all templates
  fastify.get('/', async (request, reply) => {
    const templates = await prisma.template.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { packets: true },
        },
      },
    });

    return templates.map(t => ({
      ...t,
      placeholders: JSON.parse(t.placeholders as string),
      packetCount: t._count.packets,
    }));
  });

  // Get single template
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const template = await prisma.template.findUnique({
      where: { id },
      include: {
        packets: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    return {
      ...template,
      placeholders: JSON.parse(template.placeholders as string),
    };
  });

  // Upload new template
  fastify.post('/', async (request, reply) => {
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    if (data.mimetype !== 'application/pdf') {
      return reply.status(400).send({ error: 'Only PDF files are allowed' });
    }

    // Generate unique filename
    const fileId = uuidv4();
    const fileName = `${fileId}_${data.filename}`;
    const filePath = path.join(process.cwd(), 'uploads', 'templates', fileName);

    // Save file
    const buffer = await data.toBuffer();
    await fs.writeFile(filePath, buffer);

    // Parse placeholders
    let placeholders;
    try {
      placeholders = await parseTemplatePlaceholders(filePath);
    } catch (err) {
      // If parsing fails, still save the template with empty placeholders
      console.error('Failed to parse placeholders:', err);
      placeholders = [];
    }

    // Get name from form fields or filename
    const fields = data.fields as Record<string, any>;
    const name = fields.name?.value || data.filename.replace('.pdf', '');
    const description = fields.description?.value || null;

    // Create template record
    const template = await prisma.template.create({
      data: {
        name,
        description,
        fileName: data.filename,
        filePath: `templates/${fileName}`,
        placeholders: JSON.stringify(placeholders),
      },
    });

    const roles = getUniqueRoles(placeholders);

    return {
      ...template,
      placeholders,
      roles,
    };
  });

  // Update template metadata
  fastify.patch<{
    Params: { id: string };
    Body: { name?: string; description?: string };
  }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const { name, description } = request.body;

    const template = await prisma.template.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
      },
    });

    return {
      ...template,
      placeholders: JSON.parse(template.placeholders as string),
    };
  });

  // Delete template
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const template = await prisma.template.findUnique({
      where: { id },
      include: { _count: { select: { packets: true } } },
    });

    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    if (template._count.packets > 0) {
      return reply.status(400).send({
        error: 'Cannot delete template with existing packets',
      });
    }

    // Delete file
    try {
      const fullPath = path.join(process.cwd(), 'uploads', template.filePath);
      await fs.unlink(fullPath);
    } catch (err) {
      console.error('Failed to delete template file:', err);
    }

    await prisma.template.delete({ where: { id } });

    return { success: true };
  });

  // Re-parse placeholders
  fastify.post<{ Params: { id: string } }>('/:id/parse', async (request, reply) => {
    const { id } = request.params;

    const template = await prisma.template.findUnique({ where: { id } });

    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    const fullPath = path.join(process.cwd(), 'uploads', template.filePath);
    const placeholders = await parseTemplatePlaceholders(fullPath);

    await prisma.template.update({
      where: { id },
      data: { placeholders: JSON.stringify(placeholders) },
    });

    return {
      ...template,
      placeholders,
      roles: getUniqueRoles(placeholders),
    };
  });

  // Get template roles
  fastify.get<{ Params: { id: string } }>('/:id/roles', async (request, reply) => {
    const { id } = request.params;

    const template = await prisma.template.findUnique({ where: { id } });

    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    const placeholders = JSON.parse(template.placeholders as string);
    const roles = getUniqueRoles(placeholders);

    return { roles, placeholders };
  });
};
