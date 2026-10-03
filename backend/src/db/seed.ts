import bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from './schema.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const SALT_ROUNDS = 10;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function main() {
  console.log('Seeding database...');

  const isProduction = process.env.NODE_ENV === 'production';

  const adminEmail = process.env.ADMIN_SEED_EMAIL || (isProduction ? '' : 'admin@example.com');
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || (isProduction ? '' : 'admin123');
  const adminName = process.env.ADMIN_SEED_NAME || 'Admin';

  // Runs on every deploy: missing/weak seed settings skip seeding instead of
  // crashing the container (the admin account usually exists already).
  if (!adminEmail || !adminPassword) {
    console.warn(
      'Seed skipped: set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD to create the initial admin account.'
    );
    return;
  }

  if (isProduction && adminPassword.length < 12) {
    console.warn('Seed skipped: ADMIN_SEED_PASSWORD must be at least 12 characters in production.');
    return;
  }

  const adminHash = await hashPassword(adminPassword);

  // Upsert admin user
  let admin = await db.query.users.findFirst({
    where: eq(schema.users.email, adminEmail.toLowerCase()),
  });

  if (!admin) {
    [admin] = await db.insert(schema.users).values({
      email: adminEmail.toLowerCase(),
      passwordHash: adminHash,
      name: adminName,
      role: 'admin',
      isActive: true,
    }).returning();
  }
  console.log(`Admin user ready: ${admin!.email}`);

  // In development only, create a demo regular user
  if (!isProduction) {
    const userPassword = await hashPassword('user123');

    let user = await db.query.users.findFirst({
      where: eq(schema.users.email, 'user@example.com'),
    });

    if (!user) {
      [user] = await db.insert(schema.users).values({
        email: 'user@example.com',
        passwordHash: userPassword,
        name: 'Demo User',
        role: 'user',
        isActive: true,
      }).returning();
    }
    console.log(`Demo user ready: ${user!.email}`);

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
    await pool.end();
  });
