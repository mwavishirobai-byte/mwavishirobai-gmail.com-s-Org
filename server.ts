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

// Initialize Relational SQLite Database & Initial Seeds at startup
getDatabase();

const app = express();
const PORT = 3000;

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

// ----------------- REALTIME SSE ENDPOINT -----------------
app.get('/api/realtime', authenticateOptional, (req: AuthenticatedRequest, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const clientId = `sse-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  realtimeService.addClient({
    id: clientId,
    userId: req.user?.id,
    role: req.user?.role,
    res,
  });
});

// ----------------- SECURE STORAGE ENDPOINTS -----------------
app.post('/api/storage/upload', authenticateOptional, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { dataUrlOrBase64, fileType = 'general', originalFilename, isPrivate = true } = req.body;
    if (!dataUrlOrBase64) {
      return res.status(400).json({ error: 'File content data is required.' });
    }

    const stored = storageService.saveBase64File({
      ownerId: req.user?.id,
      fileType,
      dataUrlOrBase64,
      originalFilename,
      isPrivate,
    });

    res.status(201).json({
      success: true,
      fileId: stored.id,
      fileUrl: `/api/storage/files/${stored.id}`,
      originalFilename: stored.originalFilename,
      mimeType: stored.mimeType,
      fileSize: stored.fileSize,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'File upload failed.' });
  }
});

app.get('/api/storage/files/:fileId', authenticateOptional, (req: AuthenticatedRequest, res: Response) => {
  try {
    const fileData = storageService.getFile(req.params.fileId);
    if (!fileData) {
      return res.status(404).json({ error: 'File not found or has been purged.' });
    }

    const { record, buffer } = fileData;

    // Security check for private files (prescriptions, payment receipts, etc.)
    if (record.isPrivate) {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required to access this private document.' });
      }

      const isOwner = req.user.id === record.ownerId;
      const isStaff = ['admin', 'pharmacist', 'staff', 'super_admin'].includes(req.user.role);

      if (!isOwner && !isStaff) {
        // Also check if this file belongs to an order or prescription owned by the user
        const db = getDatabase();
        const linkedPrescription = db.prepare('SELECT id FROM prescriptions WHERE customer_id = ? AND (file_url LIKE ? OR id = ?)').get(req.user.id, `%${record.id}%`, record.id);
        const linkedPayment = db.prepare('SELECT p.id FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.customer_id = ? AND (p.proof_file_id LIKE ? OR p.proof_file_id = ?)').get(req.user.id, `%${record.id}%`, record.id);
        if (!linkedPrescription && !linkedPayment) {
          return res.status(403).json({ error: 'Forbidden. You are not authorized to access this private medical/financial document.' });
        }
      }
    }

    res.setHeader('Content-Type', record.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${record.originalFilename}"`);
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error streaming file.' });
  }
});

// ----------------- PUBLIC API ENDPOINTS -----------------

// Health & System Info
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    pharmacy: 'Gods Favor Pharmacy',
    location: 'Kitale Town, along Kijana Wamalwa Road, Kitale, Kenya',
    doctorContact: '07417758578',
    paymentMethod: 'Pochi la Biashara — 07417758578',
    activeRealtimeClients: realtimeService.getActiveClientCount(),
    timestamp: new Date().toISOString(),
  });
});

// Pharmacy Business Information & Settings
app.get('/api/settings', (req: Request, res: Response) => {
  try {
    const settings = getSettings();
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve settings' });
  }
});

// Categories
app.get('/api/categories', (req: Request, res: Response) => {
  try {
    const categories = getCategories();
    res.json(categories);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve categories' });
  }
});

// Products
app.get('/api/products', (req: Request, res: Response) => {
  try {
    const categoryId = req.query.category as string | undefined;
    const search = req.query.q as string | undefined;
    const prescription = req.query.prescription === 'true' ? true : req.query.prescription === 'false' ? false : undefined;
    const featured = req.query.featured === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const result = getProducts({
      categoryId,
      search,
      prescriptionRequired: prescription,
      featuredOnly: featured,
      limit,
      offset,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve products' });
  }
});

app.get('/api/products/:idOrSlug', (req: Request, res: Response) => {
  try {
    const product = getProductBySlugOrId(req.params.idOrSlug);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(product);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve product details' });
  }
});

// Cart Total Calculation (Server-authoritative)
app.post('/api/cart/calculate', (req: Request, res: Response) => {
  try {
    const { items, fulfillmentMethod = 'pickup' } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array is required' });
    }
    const calculation = calculateOrderTotals(items, fulfillmentMethod);
    res.json(calculation);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Calculation error' });
  }
});

// Order Creation
app.post('/api/orders', authenticateOptional, (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      customerName,
      customerPhone,
      customerEmail,
      items,
      fulfillmentMethod,
      deliveryAddress,
      deliveryLandmark,
      notes,
      prescriptionId,
      paymentReference,
      paymentProofUrl,
    } = req.body;

    const customerId = req.user ? req.user.id : undefined;

    const order = createOrder({
      customerId,
      customerName,
      customerPhone,
      customerEmail,
      items,
      fulfillmentMethod,
      deliveryAddress,
      deliveryLandmark,
      notes,
      prescriptionId,
      paymentReference,
      paymentProofUrl,
    });

    res.status(201).json(order);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create order' });
  }
});

// Track Order (Public by orderNumber + phone)
app.get('/api/orders/track', (req: Request, res: Response) => {
  try {
    const orderNumber = req.query.orderNumber as string;
    const phone = req.query.phone as string;

    if (!orderNumber) {
      return res.status(400).json({ error: 'Order number is required' });
    }

    const order = getOrderByNumberOrId(orderNumber, phone);
    if (!order) {
      return res.status(404).json({ error: 'Order not found. Please verify the order number and contact phone.' });
    }

    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error tracking order' });
  }
});

app.get('/api/orders/:id', authenticateOptional, (req: AuthenticatedRequest, res: Response) => {
  try {
    const order = getOrderByNumberOrId(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Access control check:
    // If order was placed under a customer account, require authentication and verify ownership or staff privilege
    if (order.customerId) {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required to view this order.' });
      }
      const isOwner = req.user.id === order.customerId;
      const isStaff = ['admin', 'pharmacist', 'staff', 'super_admin'].includes(req.user.role);
      if (!isOwner && !isStaff) {
        return res.status(403).json({ error: 'Forbidden. You are not authorized to view this order.' });
      }
    }

    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error retrieving order' });
  }
});

// Submit Payment for existing order (Pochi la Biashara)
app.post('/api/payments/submit', paymentRateLimiter, authenticateOptional, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderId, transactionReference, proofUrl } = req.body;
    if (!orderId || !transactionReference) {
      return res.status(400).json({ error: 'Order ID and transaction reference are required.' });
    }

    const existingOrder = getOrderByNumberOrId(orderId);
    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Authorization check for payments
    if (existingOrder.customerId) {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required to submit payment for this account order.' });
      }
      const isOwner = req.user.id === existingOrder.customerId;
      const isStaff = ['admin', 'pharmacist', 'staff', 'super_admin'].includes(req.user.role);
      if (!isOwner && !isStaff) {
        return res.status(403).json({ error: 'Forbidden. You cannot submit payment for another customer\'s order.' });
      }
    }

    const order = submitOrderPayment(orderId, transactionReference, proofUrl);
    res.json({
      success: true,
      message: 'Payment details submitted successfully. Our pharmacy team will verify and dispatch your order.',
      order,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to submit payment' });
  }
});

// Prescriptions
app.post('/api/prescriptions', prescriptionRateLimiter, authenticateOptional, (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      customerName,
      customerPhone,
      customerEmail,
      fileUrl,
      fileName,
      fileType,
      notes,
      medicationsRequested,
      doctorName,
      hospitalName,
    } = req.body;

    if (!fileUrl || typeof fileUrl !== 'string') {
      return res.status(400).json({ error: 'Valid prescription document URL is required.' });
    }

    // Associate file with customer if authenticated
    const customerId = req.user ? req.user.id : undefined;
    if (customerId && fileUrl.startsWith('/api/storage/files/')) {
      const fileId = fileUrl.replace('/api/storage/files/', '').trim();
      const db = getDatabase();
      db.prepare('UPDATE secure_files SET owner_id = ? WHERE id = ? AND (owner_id IS NULL OR owner_id = ?)').run(customerId, fileId, customerId);
    }

    const prescription = createPrescription({
      customerId,
      customerName,
      customerPhone,
      customerEmail,
      fileUrl,
      fileName: fileName || 'Prescription_Document',
      fileType: fileType || 'image/jpeg',
      notes,
      medicationsRequested,
      doctorName,
      hospitalName,
    });

    res.status(201).json({
      success: true,
      message: 'Prescription uploaded successfully. A registered pharmacist will review it promptly.',
      prescription,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to upload prescription' });
  }
});

app.get('/api/prescriptions/:id', authenticateOptional, (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const prescription = db.prepare('SELECT * FROM prescriptions WHERE id = ? OR prescription_number = ?').get(req.params.id, req.params.id) as any;
    if (!prescription) {
      return res.status(404).json({ error: 'Prescription not found' });
    }

    if (prescription.customer_id) {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required to view this prescription.' });
      }
      const isOwner = req.user.id === prescription.customer_id;
      const isStaff = ['admin', 'pharmacist', 'staff', 'super_admin'].includes(req.user.role);
      if (!isOwner && !isStaff) {
        return res.status(403).json({ error: 'Forbidden. You are not authorized to view this prescription.' });
      }
    } else if (req.user) {
      const isStaff = ['admin', 'pharmacist', 'staff', 'super_admin'].includes(req.user.role);
      const matchesGuest = req.user.email?.toLowerCase() === prescription.customer_email?.toLowerCase() || req.user.phone === prescription.customer_phone;
      if (!isStaff && !matchesGuest) {
        return res.status(403).json({ error: 'Forbidden. You are not authorized to view this prescription.' });
      }
    }

    res.json(prescription);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve prescription' });
  }
});

// Appointments
app.post('/api/appointments', authenticateOptional, (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      customerName,
      customerPhone,
      customerEmail,
      serviceId,
      appointmentDate,
      appointmentTime,
      notes,
    } = req.body;

    const customerId = req.user ? req.user.id : undefined;

    const appointment = createAppointment({
      customerId,
      customerName,
      customerPhone,
      customerEmail,
      serviceId,
      appointmentDate,
      appointmentTime,
      notes,
    });

    res.status(201).json({
      success: true,
      message: 'Appointment requested successfully. Our pharmacy staff will confirm your slot.',
      appointment,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to request appointment' });
  }
});

// Services
app.get('/api/services', (req: Request, res: Response) => {
  try {
    const services = getServices();
    res.json(services);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve services' });
  }
});

// Articles / Health tips
app.get('/api/articles', (req: Request, res: Response) => {
  try {
    const articles = getArticles();
    res.json(articles);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve health articles' });
  }
});

app.get('/api/articles/:slug', (req: Request, res: Response) => {
  try {
    const article = getArticleBySlug(req.params.slug);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }
    res.json(article);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve article' });
  }
});

// Contact Messages
app.post('/api/contact', contactRateLimiter, (req: Request, res: Response) => {
  try {
    const { name, email, phone, subject, message } = req.body;
    const msg = createContactMessage({ name, email, phone, subject, message });
    res.status(201).json({
      success: true,
      message: 'Thank you for reaching out to Gods Favor Pharmacy. We will respond promptly.',
      contactMessage: msg,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to send message' });
  }
});

// ----------------- AUTHENTICATION ENDPOINTS -----------------

app.post('/api/auth/register', authRateLimiter, (req: Request, res: Response) => {
  try {
    const { fullName, phone, email, password, address } = req.body;
    if (!fullName || !phone || !email || !password) {
      return res.status(400).json({ error: 'Full name, phone, email, and password are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = authService.register(
      { fullName, phone, email, password, address },
      { ip: clientIp, userAgent }
    );
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Registration failed' });
  }
});

app.post('/api/auth/login', authRateLimiter, (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = authService.login(email, password, { ip: clientIp, userAgent });
    res.json(result);
  } catch (err: any) {
    res.status(401).json({ error: err.message || 'Login failed' });
  }
});

app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.sessionId) {
      authService.revokeSession(req.user.sessionId, req.user.id);
    }
    res.json({ success: true, message: 'Logged out successfully. Session revoked.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to logout' });
  }
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = authService.getUserById(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }
    res.json({ user });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error fetching user' });
  }
});

// Customer Account Records
app.get('/api/account/orders', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = getOrders({ customerId: req.user!.id });
    res.json(result.orders);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve orders' });
  }
});

app.get('/api/account/prescriptions', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = getPrescriptions({ customerId: req.user!.id });
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve prescriptions' });
  }
});

app.get('/api/account/appointments', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = getAppointments({ customerId: req.user!.id });
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve appointments' });
  }
});

// ----------------- AI CLINICAL ASSISTANT (GEMINI HIGH THINKING) -----------------

app.post('/api/ai/health-assistant', aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { query, context } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query prompt is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.json({
        answer: `Thank you for consulting Gods Favor Pharmacy Kitale. For personalized medical evaluation, specific dosage, and prescription medicine inquiries, please speak directly to our licensed clinical pharmacist or doctor at 07417758578 or visit our pharmacy along Kijana Wamalwa Road, Kitale Town.`,
        disclaimer: 'This automated guidance is for educational reference only and does not substitute professional clinical evaluation or emergency medical care.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const systemInstruction = `You are the Virtual Health & Clinical Medication Information Assistant for Gods Favor Pharmacy in Kitale Town, Kenya (along Kijana Wamalwa Road).
Contact Phone for Pharmacist / Doctor: 07417758578.
Payment Method: Pochi la Biashara (07417758578).

Clinical Guidelines:
1. Provide accurate, clear, evidence-based medication information, OTC remedies, common side effects, and general wellness advice relevant to Kenya / East African healthcare contexts.
2. ALWAYS include a clear safety caution: Never prescribe restricted prescription medicines without a doctor's valid review.
3. If the user presents severe red-flag symptoms (severe chest pain, difficulty breathing, high infant fever, severe bleeding, signs of stroke), advise them to seek IMMEDIATE emergency hospital care in Kitale (e.g. Kitale County Referral Hospital).
4. Direct users to call or WhatsApp our clinical doctor / pharmacist on 07417758578 for personalized medication counseling.
5. Keep explanations warm, professional, accessible, and structured with concise bullet points.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Patient Query: ${query}\nAdditional Context: ${context || 'General inquiry'}`,
      config: {
        systemInstruction,
      },
    });

    res.json({
      answer: response.text || 'Thank you for contacting Gods Favor Pharmacy. Please consult our pharmacist at 07417758578 for detailed guidance.',
      disclaimer: 'Notice: This health guidance is for educational reference. For prescription medicines, official diagnosis, or urgent concerns, please consult our pharmacist at 07417758578 or visit our Kitale clinic.',
    });
  } catch (err: any) {
    console.error('AI assistant error:', err);
    res.json({
      answer: 'Our pharmacy clinical team is available to assist you directly. Please contact our pharmacist or doctor on 07417758578 or visit our branch along Kijana Wamalwa Road in Kitale.',
      disclaimer: 'Educational information only. Please speak directly to our clinical staff.',
    });
  }
});

// ----------------- ADMIN & STAFF RBAC ENDPOINTS -----------------

// Admin Dashboard Metrics
app.get('/api/admin/metrics', requireStaffAuth, requirePermission('orders:view'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const metrics = getAdminMetrics();
    res.json(metrics);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load admin metrics' });
  }
});

// Admin Orders
app.get('/api/admin/orders', requireStaffAuth, requirePermission('orders:view'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = req.query.status as any;
    const paymentStatus = req.query.paymentStatus as any;
    const search = req.query.search as string;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const result = getOrders({ status, paymentStatus, search, limit, offset });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch orders' });
  }
});

app.patch('/api/admin/orders/:id/status', requireStaffAuth, requirePermission('orders:update_status'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, staffNotes } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    const staff = { id: req.user!.id, name: req.user!.fullName, role: req.user!.role };
    const order = updateOrderStatus(req.params.id, status, staff, staffNotes);
    res.json({ success: true, order });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update order status' });
  }
});

app.post('/api/admin/orders/:id/verify-payment', requireStaffAuth, requirePermission('payments:verify'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, notes = '' } = req.body;
    if (status !== 'verified' && status !== 'rejected') {
      return res.status(400).json({ error: 'Status must be "verified" or "rejected"' });
    }
    const staff = { id: req.user!.id, name: req.user!.fullName, role: req.user!.role };
    const order = verifyOrderPayment(req.params.id, status, notes, staff);
    res.json({
      success: true,
      message: `Payment marked as ${status}.`,
      order,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to verify payment' });
  }
});

// Admin Products CRUD
app.get('/api/admin/products', requireStaffAuth, requirePermission('products:manage'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = getProducts({ limit: 500 });
    res.json(result.products);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load products' });
  }
});

app.post('/api/admin/products', requireStaffAuth, requirePermission('products:manage'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const staff = { id: req.user!.id, name: req.user!.fullName, role: req.user!.role };
    const product = saveProduct(req.body, staff);
    res.status(201).json({ success: true, product });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create product' });
  }
});

app.put('/api/admin/products/:id', requireStaffAuth, requirePermission('products:manage'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const staff = { id: req.user!.id, name: req.user!.fullName, role: req.user!.role };
    const product = saveProduct({ ...req.body, id: req.params.id }, staff);
    res.json({ success: true, product });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update product' });
  }
});

app.delete('/api/admin/products/:id', requireStaffAuth, requirePermission('products:manage'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const staff = { id: req.user!.id, name: req.user!.fullName, role: req.user!.role };
    deleteProduct(req.params.id, staff);
    res.json({ success: true, message: 'Product archived successfully' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to archive product' });
  }
});

// Admin Prescriptions
app.get('/api/admin/prescriptions', requireStaffAuth, requirePermission('prescriptions:review'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = req.query.status as any;
    const prescriptions = getPrescriptions({ status });
    res.json(prescriptions);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve prescriptions' });
  }
});

app.patch('/api/admin/prescriptions/:id/review', requireStaffAuth, requirePermission('prescriptions:review'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, reviewNotes } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Review status is required' });
    }
    const staff = { id: req.user!.id, name: req.user!.fullName, role: req.user!.role };
    const prescription = reviewPrescription(req.params.id, status, reviewNotes || '', staff);
    res.json({ success: true, prescription });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to review prescription' });
  }
});

// Admin Appointments
app.get('/api/admin/appointments', requireStaffAuth, requirePermission('appointments:manage'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = req.query.status as any;
    const appointments = getAppointments({ status });
    res.json(appointments);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve appointments' });
  }
});

app.patch('/api/admin/appointments/:id', requireStaffAuth, requirePermission('appointments:manage'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, staffNotes } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    const staff = { id: req.user!.id, name: req.user!.fullName, role: req.user!.role };
    const appointment = updateAppointmentStatus(req.params.id, status, staffNotes, staff);
    res.json({ success: true, appointment });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update appointment' });
  }
});

// Admin Services
app.get('/api/admin/services', requireStaffAuth, requirePermission('services:manage'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const services = getAllServicesAdmin();
    res.json(services);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch services' });
  }
});

app.post('/api/admin/services', requireStaffAuth, requirePermission('services:manage'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const staff = { id: req.user!.id, name: req.user!.fullName, role: req.user!.role };
    const service = saveService(req.body, staff);
    res.status(201).json({ success: true, service });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to save service' });
  }
});

app.put('/api/admin/services/:id', requireStaffAuth, requirePermission('services:manage'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const staff = { id: req.user!.id, name: req.user!.fullName, role: req.user!.role };
    const service = saveService({ ...req.body, id: req.params.id }, staff);
    res.json({ success: true, service });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update service' });
  }
});

// Admin Staff List
app.get('/api/admin/staff', requireStaffAuth, requirePermission('staff:manage'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const staffList = authService.getAllStaff();
    res.json(staffList);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch staff directory' });
  }
});

// Admin Contact Messages
app.get('/api/admin/contact-messages', requireStaffAuth, requirePermission('contact:manage'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const messages = getContactMessages();
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch messages' });
  }
});

app.patch('/api/admin/contact-messages/:id', requireStaffAuth, requirePermission('contact:manage'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, replyNotes } = req.body;
    const msg = updateContactMessageStatus(req.params.id, status, replyNotes);
    res.json({ success: true, contactMessage: msg });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update message' });
  }
});

// Admin Audit Logs
app.get('/api/admin/audit-logs', requireStaffAuth, requirePermission('audit:view'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = getAuditLogs();
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch audit logs' });
  }
});

// Admin Settings Update
app.put('/api/admin/settings', requireStaffAuth, requirePermission('settings:manage'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const staff = { id: req.user!.id, name: req.user!.fullName, role: req.user!.role };
    const updated = updateSettings(req.body, staff);
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update settings' });
  }
});

// ----------------- VITE & STATIC SPA SERVING -----------------

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gods Favor Pharmacy server running on http://0.0.0.0:${PORT}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Retrying in 1s...`);
    } else {
      console.error('Server error:', err);
    }
  });

  process.on('SIGTERM', () => {
    server.close();
  });
  process.on('SIGINT', () => {
    server.close();
  });
}

startServer();
