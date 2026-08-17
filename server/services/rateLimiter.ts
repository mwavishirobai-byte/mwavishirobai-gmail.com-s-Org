import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const ipMap = new Map<string, RateLimitRecord>();

// Clean up stale IPs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of ipMap.entries()) {
    if (now > record.resetAt) {
      ipMap.delete(key);
    }
  }
}, 5 * 60 * 1000);

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown-ip';
    const key = `${req.baseUrl || req.path}:${clientIp}`;
    const now = Date.now();

    let record = ipMap.get(key);
    if (!record || now > record.resetAt) {
      record = {
        count: 1,
        resetAt: now + options.windowMs,
      };
      ipMap.set(key, record);
      return next();
    }

    record.count += 1;
    if (record.count > options.max) {
      const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        error: options.message || 'Too many requests. Please slow down and try again shortly.',
        retryAfter: retryAfterSec,
      });
    }

    next();
  };
}
