import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import fs from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();

const SALT_ROUNDS = 10;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function main() {
  console.log('Seeding database...');

  // Create upload directories
  const dirs = ['uploads/packets', 'signed'];
  for (const dir of dirs) {
    const fullPath = path.join(process.cwd(), dir);
    await fs.mkdir(fullPath, { recursive: true });
  }
  console.log('Created upload directories');

  // --- Admin user setup ---
  // In production: use ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD env vars
  // In development: fall back to demo credentials
  const isProduction = process.env.NODE_ENV === 'production';

  const adminEmail = process.env.ADMIN_SEED_EMAIL || (isProduction ? '' : 'admin@example.com');
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || (isProduction ? '' : 'admin123');
  const adminName = process.env.ADMIN_SEED_NAME || 'Admin';

  if (!adminEmail || !adminPassword) {
    console.error(
      'ERROR: In production, you must set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD.\n' +
      'These environment variables define the initial admin account.'
    );
    process.exit(1);
  }

  if (isProduction && adminPassword.length < 12) {
    console.error('ERROR: ADMIN_SEED_PASSWORD must be at least 12 characters in production.');
    process.exit(1);
  }

  const adminHash = await hashPassword(adminPassword);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail.toLowerCase() },
    update: {},
    create: {
      email: adminEmail.toLowerCase(),
      passwordHash: adminHash,
      name: adminName,
      role: 'admin',
      isActive: true,
    },
  });
  console.log(`Admin user ready: ${admin.email}`);

  // In development only, create a demo regular user
  if (!isProduction) {
    const userPassword = await hashPassword('user123');
    const user = await prisma.user.upsert({
      where: { email: 'user@example.com' },
      update: {},
      create: {
        email: 'user@example.com',
        passwordHash: userPassword,
        name: 'Demo User',
        role: 'user',
        isActive: true,
      },
    });
    console.log(`Demo user ready: ${user.email}`);

    console.log('\nDev credentials:');
    console.log('  Admin: admin@example.com / admin123');
    console.log('  User:  user@example.com / user123');
  }

  console.log('\nSeeding complete!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
