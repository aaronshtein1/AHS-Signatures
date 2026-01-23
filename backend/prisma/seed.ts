import { PrismaClient } from '@prisma/client';
import { createSampleTemplate } from '../src/services/pdf.service.js';
import { generateSecureToken, getTokenExpiryDate } from '../src/utils/token.js';
import fs from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create upload directories
  const dirs = ['uploads/templates', 'uploads/signatures', 'signed'];
  for (const dir of dirs) {
    const fullPath = path.join(process.cwd(), dir);
    await fs.mkdir(fullPath, { recursive: true });
  }

  // Create sample templates
  const templates = [
    {
      name: 'Employee Acknowledgment Form',
      description: 'Standard employee acknowledgment for policy updates',
      roles: ['employee', 'manager'],
    },
    {
      name: 'NDA Agreement',
      description: 'Non-disclosure agreement for contractors',
      roles: ['contractor', 'company'],
    },
    {
      name: 'Equipment Receipt',
      description: 'Acknowledgment of equipment received',
      roles: ['recipient'],
    },
  ];

  for (const t of templates) {
    // Generate PDF with placeholders
    const pdfBytes = await createSampleTemplate(t.name, t.roles);
    const fileName = `demo_${t.name.toLowerCase().replace(/\s+/g, '_')}.pdf`;
    const filePath = path.join(process.cwd(), 'uploads', 'templates', fileName);
    await fs.writeFile(filePath, pdfBytes);

    // Build placeholder data
    const placeholders = [];
    let yPos = 595;

    for (const role of t.roles) {
      placeholders.push({
        type: 'SIGNATURE',
        role,
        pageNumber: 1,
        x: 50,
        y: yPos,
        width: 200,
        height: 50,
      });
      placeholders.push({
        type: 'DATE',
        role,
        pageNumber: 1,
        x: 340,
        y: yPos + 25,
        width: 100,
        height: 25,
      });
      yPos -= 100;
    }

    await prisma.template.create({
      data: {
        name: t.name,
        description: t.description,
        fileName,
        filePath: `templates/${fileName}`,
        placeholders: JSON.stringify(placeholders),
      },
    });

    console.log(`✅ Created template: ${t.name}`);
  }

  // Create a sample signing packet
  const employeeTemplate = await prisma.template.findFirst({
    where: { name: 'Employee Acknowledgment Form' },
  });

  if (employeeTemplate) {
    const packet = await prisma.signingPacket.create({
      data: {
        name: 'Q1 Policy Update Acknowledgment - John Doe',
        templateId: employeeTemplate.id,
        status: 'draft',
        recipients: {
          create: [
            {
              roleName: 'employee',
              name: 'John Doe',
              email: 'john.doe@example.com',
              order: 1,
              token: generateSecureToken(),
              tokenExpiresAt: getTokenExpiryDate(),
            },
            {
              roleName: 'manager',
              name: 'Jane Smith',
              email: 'jane.smith@example.com',
              order: 2,
              token: generateSecureToken(),
              tokenExpiresAt: getTokenExpiryDate(),
            },
          ],
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        packetId: packet.id,
        action: 'created',
        details: 'Demo packet created via seed',
      },
    });

    console.log(`✅ Created sample packet: ${packet.name}`);
  }

  console.log('🌱 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
