import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  getDatabase,
  authService,
  storageService,
  realtimeService,
  authenticateOptional,
  requireAuth,
  requireStaffAuth,
  requirePermission,
  getSettings,
  updateSettings,
  getCategories,
  getAllCategoriesAdmin,
  getProducts,
  getProductBySlugOrId,
  saveProduct,
  deleteProduct,
  calculateOrderTotals,
  createOrder,
  submitOrderPayment,
  verifyOrderPayment,
  updateOrderStatus,
  getOrders,
  getOrderByNumberOrId,
  createPrescription,
  reviewPrescription,
  getPrescriptions,
  createAppointment,
  updateAppointmentStatus,
  getAppointments,
  getServices,
  getAllServicesAdmin,
  saveService,
  getArticles,
  getArticleBySlug,
  saveArticle,
  createContactMessage,
  getContactMessages,
  updateContactMessageStatus,
  getAdminMetrics,
  getAuditLogs,
} from './server/db';
import { createRateLimiter } from './server/services/rateLimiter';
import { AuthenticatedRequest } from './server/services/rbacService';

// Initialize the database once per server instance. Vercel's serverless runtime
// may reuse an instance, so this remains compatible with the existing architecture.
getDatabase();

export const app = express();
const PORT = Number(process.env.PORT || 3000);

// Body Parsers with 25MB limit for secure file and prescription uploads
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// ----------------- RATE LIMITERS -----------------
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts. Please wait 15 minutes before trying again.',
});

const contactRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 15,
  message: 'Message rate limit exceeded. Please try again later.',
});

const aiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'AI Assistant rate limit reached. Please wait a moment.',
});

const paymentRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
});

const prescriptionRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 25,
});
