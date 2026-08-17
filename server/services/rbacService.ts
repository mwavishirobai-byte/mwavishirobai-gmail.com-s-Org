import { Request, Response, NextFunction } from 'express';
import { authService, JwtPayload } from './authService';
import { UserRole } from '../../src/types';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export function authenticateOptional(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query.token && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (token) {
    const decoded = authService.verifySessionToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }
  next();
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query.token && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  const decoded = authService.verifySessionToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Session expired, revoked, or invalid. Please sign in again.' });
  }
  req.user = decoded;
  next();
}

export function requireStaffAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query.token && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Staff authentication required. Please sign in.' });
  }

  const decoded = authService.verifySessionToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Staff session expired or revoked. Please sign in again.' });
  }

  const role = decoded.role;
  if (role !== 'admin' && role !== 'pharmacist' && role !== 'staff' && role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden. Access restricted to authorized pharmacy staff.' });
  }

  req.user = decoded;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden. Requires one of: ${allowedRoles.join(', ')}.` });
    }
    next();
  };
}

export function requirePermission(...requiredPermissions: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (req.user.role === 'super_admin') {
      return next(); // Super admin bypasses
    }

    const userPerms = req.user.permissions || authService.getUserPermissions(req.user.role);
    const hasAll = requiredPermissions.every(p => userPerms.includes(p));

    if (!hasAll) {
      return res.status(403).json({
        error: 'Forbidden. You do not possess the required clinical or administrative permission.',
        requiredPermissions,
      });
    }

    next();
  };
}
