import bcrypt from 'bcryptjs';
import { db, users, eq } from '../db/index.js';

const SALT_ROUNDS = 10;

export const authService = {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  },

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },

  async findUserByEmail(email: string) {
    return db.query.users.findFirst({
      where: eq(users.email, email.toLowerCase()),
    }) ?? null;
  },

  async findUserById(id: string) {
    return db.query.users.findFirst({
      where: eq(users.id, id),
      columns: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
      },
    }) ?? null;
  },

  async updateLastLogin(userId: string) {
    const [updated] = await db.update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  },

  async createUser(data: {
    email: string;
    password: string;
    name: string;
    role?: 'admin' | 'user';
  }) {
    const passwordHash = await this.hashPassword(data.password);
    const [user] = await db.insert(users).values({
      email: data.email.toLowerCase(),
      passwordHash,
      name: data.name,
      role: data.role || 'user',
    }).returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    });
    return user;
  },
};
