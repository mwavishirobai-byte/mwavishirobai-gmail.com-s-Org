import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDatabase } from '../db/database';

const UPLOADS_DIR = path.join(process.cwd(), 'data', 'secure_uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
  'application/pdf',
]);

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

export interface StoredFileRecord {
  id: string;
  ownerId?: string;
  fileType: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  originalFilename: string;
  isPrivate: boolean;
  createdAt: string;
}

export const storageService = {
  saveBase64File(options: {
    ownerId?: string;
    fileType: 'prescription' | 'payment_proof' | 'general';
    dataUrlOrBase64: string;
    originalFilename?: string;
    isPrivate?: boolean;
  }): StoredFileRecord {
    let mimeType = 'image/jpeg';
    let base64Data = options.dataUrlOrBase64;

    if (options.dataUrlOrBase64.startsWith('data:')) {
      const matches = options.dataUrlOrBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        base64Data = matches[2];
      }
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new Error(`Unsupported file type (${mimeType}). Allowed formats: JPG, PNG, WEBP, and PDF.`);
    }

    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error('File exceeds the maximum allowable upload limit of 15MB.');
    }

    const fileId = `file-${crypto.randomUUID()}`;
    const ext = mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
    const diskFileName = `${fileId}${ext}`;
    const diskPath = path.join(UPLOADS_DIR, diskFileName);

    fs.writeFileSync(diskPath, buffer);

    const db = getDatabase();
    const isPrivate = options.isPrivate !== undefined ? (options.isPrivate ? 1 : 0) : 1;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO secure_files (id, owner_id, file_type, mime_type, file_size, storage_path, original_filename, is_private, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fileId,
      options.ownerId || null,
      options.fileType,
      mimeType,
      buffer.length,
      diskPath,
      options.originalFilename || `upload${ext}`,
      isPrivate,
      now
    );

    return {
      id: fileId,
      ownerId: options.ownerId,
      fileType: options.fileType,
      mimeType,
      fileSize: buffer.length,
      storagePath: diskPath,
      originalFilename: options.originalFilename || `upload${ext}`,
      isPrivate: Boolean(isPrivate),
      createdAt: now,
    };
  },

  getFile(fileId: string): { record: StoredFileRecord; buffer: Buffer } | null {
    if (!fileId || typeof fileId !== 'string') return null;
    // Disallow path traversal sequences
    if (fileId.includes('..') || fileId.includes('/') || fileId.includes('\\')) {
      return null;
    }

    const db = getDatabase();
    const row = db.prepare('SELECT * FROM secure_files WHERE id = ?').get(fileId) as any;
    if (!row) return null;

    const resolvedPath = path.resolve(row.storage_path);
    const resolvedUploadsDir = path.resolve(UPLOADS_DIR);
    if (!resolvedPath.startsWith(resolvedUploadsDir)) {
      return null;
    }

    if (!fs.existsSync(resolvedPath)) {
      return null;
    }

    const buffer = fs.readFileSync(resolvedPath);
    return {
      record: {
        id: row.id,
        ownerId: row.owner_id,
        fileType: row.file_type,
        mimeType: row.mime_type,
        fileSize: row.file_size,
        storagePath: resolvedPath,
        originalFilename: row.original_filename,
        isPrivate: Boolean(row.is_private),
        createdAt: row.created_at,
      },
      buffer,
    };
  }
};
