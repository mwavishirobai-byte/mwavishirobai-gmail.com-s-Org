import app from '../server';

export default function handler(req: any, res: any) {
  if (req.originalUrl && req.originalUrl.startsWith('/api')) {
    req.url = req.originalUrl;
  }
  return app(req, res);
}
