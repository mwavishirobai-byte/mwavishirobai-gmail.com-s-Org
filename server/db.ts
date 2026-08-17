// =========================================================
// GODS FAVOR PHARMACY — PERSISTENCE & DATA SERVICES FACADE
// Kitale Town, along Kijana Wamalwa Road, Kitale, Kenya
// Backed by SQLite Relational Database Engine
// =========================================================

export { getDatabase } from './db/database';
export { authService, generateToken, verifyToken } from './services/authService';
export {
  authenticateOptional,
  requireAuth,
  requireStaffAuth,
  requireRole,
  requirePermission,
} from './services/rbacService';
export { storageService } from './services/storageService';
export { realtimeService } from './services/realtimeService';
export {
  logAudit,
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
  getSettings,
  updateSettings,
  getAdminMetrics,
  getAuditLogs,
} from './services/pharmacyService';
