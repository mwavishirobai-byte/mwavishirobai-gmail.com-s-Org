import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getDatabase } from '../db/database';
import { User, UserRole, AuthResponse } from '../../src/types';

// Load JWT Secret strictly from environment with no fallback
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim().length < 32) {
    throw new Error(
      'CRITICAL SECURITY CONFIGURATION ERROR: JWT_SECRET environment variable is missing or shorter than 32 characters. Please configure a strong secret in environment variables.'
    );
  }
  return secret.trim();
}

export interface JwtPayload {
  id: string; // user profile id
  sessionId: string; // user_sessions record id
  email: string;
  phone?: string;
  role: UserRole;
  fullName: string;
  permissions?: string[];
}

export function generateToken(user: User, sessionId: string): string {
  const payload: Omit<JwtPayload, 'permissions'> = {
    id: user.id,
    sessionId,
    email: user.email,
    phone: user.phone,
    role: user.role,
    fullName: user.fullName,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

export function verifySessionToken(token: string): (JwtPayload & { permissions: string[] }) | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
    if (!decoded || !decoded.id || !decoded.sessionId) {
      return null;
    }

    const db = getDatabase();

    // Query session with join on profile
    const session = db.prepare(`
      SELECT s.id as session_id, s.profile_id, s.expires_at, s.revoked_at,
             p.id as user_id, p.email, p.phone, p.full_name, p.role, p.is_active
      FROM user_sessions s
      JOIN profiles p ON p.id = s.profile_id
      WHERE s.id = ? AND s.profile_id = ?
    `).get(decoded.sessionId, decoded.id) as any;

    if (!session) {
      return null;
    }

    // Check if session has been revoked (e.g. via logout)
    if (session.revoked_at) {
      return null;
    }

    // Check if session has expired in database
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      return null;
    }

    // Check if profile is active
    if (!session.is_active) {
      return null;
    }

    // Dynamic Permission & Role Refresh:
    // Always obtain current role and permissions directly from the database
    const currentRole = session.role as UserRole;
    const permissions = authService.getUserPermissions(currentRole);

    return {
      id: session.user_id,
      sessionId: session.session_id,
      email: session.email,
      phone: session.phone || undefined,
      role: currentRole,
      fullName: session.full_name,
      permissions,
    };
  } catch {
    return null;
  }
}

export function verifyToken(token: string): (JwtPayload & { permissions: string[] }) | null {
  return verifySessionToken(token);
}

export const authService = {
  generateToken,
  verifyToken,
  verifySessionToken,

  getUserPermissions(roleName: string): string[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT p.code
      FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN roles r ON r.id = rp.role_id
      WHERE r.name = ?
    `).all(roleName) as Array<{ code: string }>;
    return rows.map(r => r.code);
  },

  getUserById(id: string): User | null {
    const db = getDatabase();
    const row = db.prepare('SELECT id, email, full_name, phone, address, role, is_active, created_at, updated_at FROM profiles WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      phone: row.phone,
      address: row.address || '',
      role: row.role as UserRole,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  register(userData: {
    fullName: string;
    phone: string;
    email: string;
    password: string;
    address?: string;
  }, clientMeta?: { ip?: string; userAgent?: string }): AuthResponse {
    const db = getDatabase();
    const emailClean = userData.email.toLowerCase().trim();
    const phoneClean = userData.phone.trim();
    const nameClean = userData.fullName.trim();

    const existing = db.prepare('SELECT id FROM profiles WHERE email = ?').get(emailClean) as any;
    if (existing) {
      throw new Error('An account with this email address is already registered.');
    }

    if (userData.password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }

    const userId = `usr-${crypto.randomUUID()}`;
    const sessionId = `ses-${crypto.randomUUID()}`;
    const passwordHash = bcrypt.hashSync(userData.password, 10);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO profiles (id, email, full_name, phone, address, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'customer', 1, ?, ?)
    `).run(userId, emailClean, nameClean, phoneClean, userData.address?.trim() || '', now, now);

    db.prepare(`
      INSERT INTO user_passwords (profile_id, password_hash, updated_at)
      VALUES (?, ?, ?)
    `).run(userId, passwordHash, now);

    const user: User = {
      id: userId,
      email: emailClean,
      fullName: nameClean,
      phone: phoneClean,
      address: userData.address?.trim() || '',
      role: 'customer',
      createdAt: now,
      updatedAt: now,
    };

    const token = generateToken(user, sessionId);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    db.prepare(`
      INSERT INTO user_sessions (id, profile_id, token_hash, ip_address, user_agent, expires_at, revoked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(sessionId, userId, tokenHash, clientMeta?.ip || null, clientMeta?.userAgent || null, expiresAt, now);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (id, actor_id, actor_name, actor_role, action, entity_type, entity_id, details, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, 'customer', 'REGISTER', 'auth', ?, ?, ?, ?, ?)
    `).run(
      `log-${crypto.randomUUID()}`,
      userId,
      nameClean,
      userId,
      `New customer account created: ${nameClean} (${emailClean})`,
      clientMeta?.ip || null,
      clientMeta?.userAgent || null,
      now
    );

    return { user, token };
  },

  login(email: string, password: string, clientMeta?: { ip?: string; userAgent?: string }): AuthResponse {
    const db = getDatabase();
    const emailClean = email.toLowerCase().trim();

    const profile = db.prepare('SELECT id, email, full_name, phone, address, role, is_active, created_at, updated_at FROM profiles WHERE email = ?').get(emailClean) as any;
    if (!profile) {
      throw new Error('Invalid email or password.');
    }

    if (!profile.is_active) {
      throw new Error('This account has been deactivated. Please contact pharmacy management.');
    }

    const passRecord = db.prepare('SELECT password_hash FROM user_passwords WHERE profile_id = ?').get(profile.id) as any;
    if (!passRecord || !passRecord.password_hash) {
      throw new Error('Invalid authentication credentials.');
    }

    const isMatch = bcrypt.compareSync(password, passRecord.password_hash);
    if (!isMatch) {
      throw new Error('Invalid email or password.');
    }

    const user: User = {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      phone: profile.phone,
      address: profile.address || '',
      role: profile.role as UserRole,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    };

    const sessionId = `ses-${crypto.randomUUID()}`;
    const token = generateToken(user, sessionId);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO user_sessions (id, profile_id, token_hash, ip_address, user_agent, expires_at, revoked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(sessionId, user.id, tokenHash, clientMeta?.ip || null, clientMeta?.userAgent || null, expiresAt, now);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (id, actor_id, actor_name, actor_role, action, entity_type, entity_id, details, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, 'LOGIN', 'auth', ?, ?, ?, ?, ?)
    `).run(
      `log-${crypto.randomUUID()}`,
      user.id,
      user.fullName,
      user.role,
      user.id,
      `User signed in: ${user.fullName} (${user.role})`,
      clientMeta?.ip || null,
      clientMeta?.userAgent || null,
      now
    );

    return { user, token };
  },

  revokeSession(sessionId: string, actorId?: string): boolean {
    const db = getDatabase();
    const now = new Date().toISOString();
    const res = db.prepare(`
      UPDATE user_sessions
      SET revoked_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `).run(now, sessionId);

    if (res.changes > 0) {
      db.prepare(`
        INSERT INTO audit_logs (id, actor_id, actor_name, actor_role, action, entity_type, entity_id, details, created_at)
        VALUES (?, ?, 'User', 'auth', 'LOGOUT', 'session', ?, 'Session revoked on logout', ?)
      `).run(`log-${crypto.randomUUID()}`, actorId || sessionId, sessionId, now);
      return true;
    }
    return false;
  },

  getAllStaff(): User[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, email, full_name, phone, address, role, created_at, updated_at
      FROM profiles
      WHERE role IN ('admin', 'pharmacist', 'staff', 'super_admin')
      ORDER BY created_at ASC
    `).all() as any[];

    return rows.map(r => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      phone: r.phone,
      address: r.address || '',
      role: r.role as UserRole,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }
};

