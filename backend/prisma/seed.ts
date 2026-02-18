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

  // Create demo admin user
  const adminPassword = await hashPassword('admin123');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      passwordHash: adminPassword,
      name: 'Admin User',
      role: 'admin',
      isActive: true,
    },
  });
  console.log(`Created admin user: ${admin.email}`);

  // Create demo regular user
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
  console.log(`Created regular user: ${user.email}`);

  console.log('\nDemo credentials:');
  console.log('  Admin: admin@example.com / admin123');
  console.log('  User:  user@example.com / user123');
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
