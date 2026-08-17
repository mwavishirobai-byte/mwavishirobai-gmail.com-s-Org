import crypto from 'crypto';
import { getDatabase } from '../db/database';
import { realtimeService } from './realtimeService';
import {
  Category,
  Product,
  Order,
  OrderItem,
  OrderStatus,
  PaymentStatus,
  Prescription,
  PrescriptionStatus,
  Appointment,
  AppointmentStatus,
  PharmacyService,
  HealthArticle,
  ContactMessage,
  AuditLog,
  PharmacySettings,
} from '../../src/types';
import { initialSettings } from '../seedData';

// ----------------- AUDIT LOG HELPER -----------------

export function logAudit(
  actor: { id: string; name: string; role: string },
  action: string,
  entityType: 'order' | 'payment' | 'prescription' | 'appointment' | 'product' | 'service' | 'auth' | 'settings' | 'inventory',
  entityId: string,
  details: string,
  meta?: { ip?: string; userAgent?: string; metadata?: any }
): void {
  const db = getDatabase();
  const id = `log-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO audit_logs (id, actor_id, actor_name, actor_role, action, entity_type, entity_id, details, metadata_json, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    actor.id,
    actor.name,
    actor.role,
    action,
    entityType,
    entityId,
    details,
    JSON.stringify(meta?.metadata || {}),
    meta?.ip || null,
    meta?.userAgent || null,
    now
  );
}

// ----------------- CATEGORIES -----------------

export function getCategories(): Category[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT id, slug, name, description, icon_name as iconName, sort_order as "order", active FROM categories WHERE active = 1 ORDER BY sort_order ASC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    iconName: r.iconName,
    active: Boolean(r.active),
    order: r.order,
  }));
}

export function getAllCategoriesAdmin(): Category[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT id, slug, name, description, icon_name as iconName, sort_order as "order", active FROM categories ORDER BY sort_order ASC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    iconName: r.iconName,
    active: Boolean(r.active),
    order: r.order,
  }));
}

// ----------------- PRODUCTS & INVENTORY -----------------

export function getProducts(options?: {
  categoryId?: string;
  search?: string;
  prescriptionRequired?: boolean;
  featuredOnly?: boolean;
  limit?: number;
  offset?: number;
}): { products: Product[]; total: number } {
  const db = getDatabase();
  const conditions: string[] = ['p.active = 1'];
  const params: any[] = [];

  if (options?.categoryId) {
    conditions.push('p.category_id = ?');
    params.push(options.categoryId);
  }

  if (options?.prescriptionRequired !== undefined) {
    conditions.push('p.prescription_required = ?');
    params.push(options.prescriptionRequired ? 1 : 0);
  }

  if (options?.featuredOnly) {
    conditions.push('p.is_featured = 1');
  }

  if (options?.search) {
    const q = `%${options.search.toLowerCase().trim()}%`;
    conditions.push('(LOWER(p.name) LIKE ? OR LOWER(p.description) LIKE ? OR LOWER(p.brand) LIKE ? OR LOWER(p.active_ingredient) LIKE ? OR LOWER(p.sku) LIKE ?)');
    params.push(q, q, q, q, q);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM products p ${whereClause}`).get(...params) as { count: number };
  const total = countRow.count;

  const limit = options?.limit || 100;
  const offset = options?.offset || 0;

  const query = `
    SELECT 
      p.id, p.category_id as categoryId, p.name, p.slug, p.description, p.sku, p.brand,
      p.price, p.discount_price as discountPrice, p.stock_quantity as stockQuantity,
      p.prescription_required as prescriptionRequired, p.image_url as imageUrl,
      p.active, p.dosage_form as dosageForm, p.active_ingredient as activeIngredient,
      p.pack_size as packSize, p.instructions, p.warnings, p.storage_info as storageInfo,
      p.is_featured as isFeatured, p.created_at as createdAt, p.updated_at as updatedAt,
      c.name as categoryName
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereClause}
    ORDER BY p.is_featured DESC, p.name ASC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(query).all(...params, limit, offset) as any[];

  const products: Product[] = rows.map(r => ({
    id: r.id,
    categoryId: r.categoryId,
    categoryName: r.categoryName || 'General',
    name: r.name,
    slug: r.slug,
    description: r.description || '',
    sku: r.sku,
    brand: r.brand || 'Generic',
    price: Number(r.price),
    discountPrice: r.discountPrice !== null ? Number(r.discountPrice) : undefined,
    stockQuantity: Number(r.stockQuantity),
    prescriptionRequired: Boolean(r.prescriptionRequired),
    imageUrl: r.imageUrl || '',
    active: Boolean(r.active),
    dosageForm: r.dosageForm || 'Tablets',
    activeIngredient: r.activeIngredient || '',
    packSize: r.packSize || 'Standard Pack',
    instructions: r.instructions || '',
    warnings: r.warnings || '',
    storageInfo: r.storageInfo || '',
    isFeatured: Boolean(r.isFeatured),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  return { products, total };
}

export function getProductBySlugOrId(idOrSlug: string): Product | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT 
      p.id, p.category_id as categoryId, p.name, p.slug, p.description, p.sku, p.brand,
      p.price, p.discount_price as discountPrice, p.stock_quantity as stockQuantity,
      p.prescription_required as prescriptionRequired, p.image_url as imageUrl,
      p.active, p.dosage_form as dosageForm, p.active_ingredient as activeIngredient,
      p.pack_size as packSize, p.instructions, p.warnings, p.storage_info as storageInfo,
      p.is_featured as isFeatured, p.created_at as createdAt, p.updated_at as updatedAt,
      c.name as categoryName
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = ? OR p.slug = ?
  `).get(idOrSlug, idOrSlug) as any;

  if (!row) return null;

  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.categoryName || 'General',
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    sku: row.sku,
    brand: row.brand || 'Generic',
    price: Number(row.price),
    discountPrice: row.discountPrice !== null ? Number(row.discountPrice) : undefined,
    stockQuantity: Number(row.stockQuantity),
    prescriptionRequired: Boolean(row.prescriptionRequired),
    imageUrl: row.imageUrl || '',
    active: Boolean(row.active),
    dosageForm: row.dosageForm || 'Tablets',
    activeIngredient: row.activeIngredient || '',
    packSize: row.packSize || 'Standard Pack',
    instructions: row.instructions || '',
    warnings: row.warnings || '',
    storageInfo: row.storageInfo || '',
    isFeatured: Boolean(row.isFeatured),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function saveProduct(
  productData: Partial<Product>,
  actor: { id: string; name: string; role: string }
): Product {
  const db = getDatabase();
  const now = new Date().toISOString();

  if (productData.id) {
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(productData.id) as any;
    if (!existing) {
      throw new Error('Product not found.');
    }

    const previousStock = Number(existing.stock_quantity);
    const newStock = productData.stockQuantity !== undefined ? Number(productData.stockQuantity) : previousStock;

    db.prepare(`
      UPDATE products SET
        category_id = COALESCE(?, category_id),
        name = COALESCE(?, name),
        slug = COALESCE(?, slug),
        description = COALESCE(?, description),
        sku = COALESCE(?, sku),
        brand = COALESCE(?, brand),
        price = COALESCE(?, price),
        discount_price = ?,
        stock_quantity = ?,
        prescription_required = COALESCE(?, prescription_required),
        image_url = COALESCE(?, image_url),
        active = COALESCE(?, active),
        dosage_form = COALESCE(?, dosage_form),
        active_ingredient = COALESCE(?, active_ingredient),
        pack_size = COALESCE(?, pack_size),
        instructions = COALESCE(?, instructions),
        warnings = COALESCE(?, warnings),
        storage_info = COALESCE(?, storage_info),
        is_featured = COALESCE(?, is_featured),
        updated_at = ?
      WHERE id = ?
    `).run(
      productData.categoryId || null,
      productData.name || null,
      productData.slug || null,
      productData.description || null,
      productData.sku || null,
      productData.brand || null,
      productData.price !== undefined ? Number(productData.price) : null,
      productData.discountPrice !== undefined ? Number(productData.discountPrice) : null,
      newStock,
      productData.prescriptionRequired !== undefined ? (productData.prescriptionRequired ? 1 : 0) : null,
      productData.imageUrl || null,
      productData.active !== undefined ? (productData.active ? 1 : 0) : null,
      productData.dosageForm || null,
      productData.activeIngredient || null,
      productData.packSize || null,
      productData.instructions || null,
      productData.warnings || null,
      productData.storageInfo || null,
      productData.isFeatured !== undefined ? (productData.isFeatured ? 1 : 0) : null,
      now,
      productData.id
    );

    // Track inventory change if stock was adjusted
    if (newStock !== previousStock) {
      const change = newStock - previousStock;
      db.prepare(`
        INSERT INTO inventory_logs (id, product_id, change_amount, previous_quantity, new_quantity, reason, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, 'MANUAL_ADJUSTMENT', ?, ?)
      `).run(`inv-${crypto.randomUUID()}`, productData.id, change, previousStock, newStock, actor.name, now);

      realtimeService.broadcastToStaff('inventory_updated', {
        productId: productData.id,
        stockQuantity: newStock,
      });
    }

    logAudit(actor, 'PRODUCT_UPDATED', 'product', productData.id, `Updated product ${productData.name || existing.name} (Stock: ${newStock})`);
    return getProductBySlugOrId(productData.id)!;
  } else {
    if (!productData.name || !productData.categoryId || productData.price === undefined) {
      throw new Error('Product name, category, and price are required.');
    }

    const id = `prod-${crypto.randomUUID()}`;
    const slug = productData.slug || productData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const sku = productData.sku || `SKU-${Date.now().toString().slice(-6)}`;
    const stock = Number(productData.stockQuantity) || 0;

    db.prepare(`
      INSERT INTO products (
        id, category_id, name, slug, description, sku, brand, price, discount_price,
        stock_quantity, prescription_required, image_url, active, dosage_form,
        active_ingredient, pack_size, instructions, warnings, storage_info, is_featured,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      productData.categoryId,
      productData.name.trim(),
      slug,
      productData.description || '',
      sku,
      productData.brand || 'Generic',
      Number(productData.price),
      productData.discountPrice ? Number(productData.discountPrice) : null,
      stock,
      productData.prescriptionRequired ? 1 : 0,
      productData.imageUrl || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&auto=format&fit=crop&q=80',
      productData.active !== undefined ? (productData.active ? 1 : 0) : 1,
      productData.dosageForm || 'Tablets',
      productData.activeIngredient || '',
      productData.packSize || 'Standard Pack',
      productData.instructions || '',
      productData.warnings || '',
      productData.storageInfo || '',
      productData.isFeatured ? 1 : 0,
      now,
      now
    );

    logAudit(actor, 'PRODUCT_CREATED', 'product', id, `Created product ${productData.name} (Price: KSh ${productData.price}, SKU: ${sku})`);
    return getProductBySlugOrId(id)!;
  }
}

export function deleteProduct(productId: string, actor: { id: string; name: string; role: string }): void {
  const db = getDatabase();
  const existing = db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as any;
  if (!existing) throw new Error('Product not found.');

  db.prepare('UPDATE products SET active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), productId);
  logAudit(actor, 'PRODUCT_ARCHIVED', 'product', productId, `Archived product: ${existing.name}`);
}

// ----------------- CART & ORDERS -----------------

export function calculateOrderTotals(
  items: { productId: string; quantity: number }[],
  fulfillmentMethod: 'pickup' | 'delivery'
): {
  validatedItems: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  prescriptionRequired: boolean;
} {
  const db = getDatabase();
  let subtotal = 0;
  let hasPrescription = false;
  const validatedItems: OrderItem[] = [];

  for (const item of items) {
    if (item.quantity <= 0) {
      throw new Error('Item quantity must be greater than zero.');
    }
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.productId) as any;
    if (!product) {
      throw new Error(`Product is unavailable or out of catalog.`);
    }

    if (product.stock_quantity < item.quantity) {
      throw new Error(`Insufficient stock for "${product.name}". Available: ${product.stock_quantity}, Requested: ${item.quantity}.`);
    }

    const unitPrice = product.discount_price !== null && product.discount_price > 0 ? Number(product.discount_price) : Number(product.price);
    const itemSubtotal = unitPrice * item.quantity;
    subtotal += itemSubtotal;

    if (Boolean(product.prescription_required)) {
      hasPrescription = true;
    }

    validatedItems.push({
      id: `item-${crypto.randomUUID()}`,
      productId: product.id,
      productNameSnapshot: product.name,
      unitPrice,
      quantity: item.quantity,
      subtotal: itemSubtotal,
      imageUrl: product.image_url,
      prescriptionRequired: Boolean(product.prescription_required),
      dosageForm: product.dosage_form,
    });
  }

  const deliveryFee = fulfillmentMethod === 'delivery' ? 150 : 0;
  const total = subtotal + deliveryFee;

  return {
    validatedItems,
    subtotal,
    deliveryFee,
    total,
    prescriptionRequired: hasPrescription,
  };
}

export function createOrder(data: {
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  items: { productId: string; quantity: number }[];
  fulfillmentMethod: 'pickup' | 'delivery';
  deliveryAddress?: string;
  deliveryLandmark?: string;
  notes?: string;
  prescriptionId?: string;
  paymentReference?: string;
  paymentProofUrl?: string;
}): Order {
  const db = getDatabase();

  if (!data.customerName || !data.customerPhone) {
    throw new Error('Customer name and contact phone number are required.');
  }

  if (!data.items || data.items.length === 0) {
    throw new Error('Order must contain at least one item.');
  }

  if (data.fulfillmentMethod === 'delivery' && !data.deliveryAddress) {
    throw new Error('Delivery address in Kitale is required for dispatch.');
  }

  const { validatedItems, subtotal, deliveryFee, total } = calculateOrderTotals(
    data.items,
    data.fulfillmentMethod
  );

  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const orderNumber = `GFP-2026-${randomNum}`;
  const orderId = `ord-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const hasPaymentRef = Boolean(data.paymentReference?.trim());
  const initialStatus: OrderStatus = hasPaymentRef ? 'payment_submitted' : 'awaiting_payment';
  const paymentStatus: PaymentStatus = hasPaymentRef ? 'submitted' : 'unpaid';

  // Atomic stock deduction & order insert in transaction
  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Deduct Stock
    for (const item of data.items) {
      const prod = db.prepare('SELECT stock_quantity, name FROM products WHERE id = ?').get(item.productId) as any;
      const prevStock = Number(prod.stock_quantity);
      const newStock = Math.max(0, prevStock - item.quantity);

      db.prepare('UPDATE products SET stock_quantity = ?, updated_at = ? WHERE id = ?').run(newStock, now, item.productId);

      db.prepare(`
        INSERT INTO inventory_logs (id, product_id, change_amount, previous_quantity, new_quantity, reason, reference_id, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, 'ORDER_SALE', ?, ?, ?)
      `).run(`inv-${crypto.randomUUID()}`, item.productId, -item.quantity, prevStock, newStock, orderNumber, data.customerName, now);
    }

    // 2. Insert Order
    db.prepare(`
      INSERT INTO orders (
        id, order_number, customer_id, customer_name, customer_phone, customer_email,
        subtotal, delivery_fee, total, status, payment_status, fulfillment_method,
        delivery_address, delivery_landmark, notes, prescription_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId,
      orderNumber,
      data.customerId || null,
      data.customerName.trim(),
      data.customerPhone.trim(),
      data.customerEmail?.trim() || null,
      subtotal,
      deliveryFee,
      total,
      initialStatus,
      paymentStatus,
      data.fulfillmentMethod,
      data.deliveryAddress?.trim() || null,
      data.deliveryLandmark?.trim() || null,
      data.notes?.trim() || null,
      data.prescriptionId || null,
      now,
      now
    );

    // 3. Insert Order Items
    const insertItemStmt = db.prepare(`
      INSERT INTO order_items (
        id, order_id, product_id, product_name_snapshot, unit_price, quantity, subtotal, image_url, prescription_required, dosage_form
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of validatedItems) {
      insertItemStmt.run(
        item.id,
        orderId,
        item.productId,
        item.productNameSnapshot,
        item.unitPrice,
        item.quantity,
        item.subtotal,
        item.imageUrl || null,
        item.prescriptionRequired ? 1 : 0,
        item.dosageForm || null
      );
    }

    // 4. Insert Payment if reference supplied
    if (hasPaymentRef) {
      db.prepare(`
        INSERT INTO payments (
          id, order_id, method, business_number, amount, transaction_reference, proof_file_id, status, created_at, updated_at
        ) VALUES (?, ?, 'pochi_la_biashara', '07417758578', ?, ?, ?, 'submitted', ?, ?)
      `).run(
        `pay-${crypto.randomUUID()}`,
        orderId,
        total,
        data.paymentReference!.trim().toUpperCase(),
        data.paymentProofUrl || null,
        now,
        now
      );
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  const createdOrder = getOrderByNumberOrId(orderId)!;

  // Realtime Broadcast
  realtimeService.broadcastToStaff('order:new', { order: createdOrder });
  realtimeService.broadcastToStaff('order_created', { order: createdOrder });
  if (data.customerId) {
    realtimeService.broadcastToUser(data.customerId, 'order:status_updated', { order: createdOrder });
    realtimeService.broadcastToUser(data.customerId, 'order_status_updated', { order: createdOrder });
  }

  logAudit(
    { id: data.customerId || 'guest', name: data.customerName, role: 'customer' },
    'ORDER_CREATED',
    'order',
    orderId,
    `Order ${orderNumber} created. Total: KSh ${total} (${data.fulfillmentMethod}).`
  );

  return createdOrder;
}

export function getOrderByNumberOrId(idOrNumber: string, phone?: string): Order | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM orders WHERE id = ? OR LOWER(order_number) = LOWER(?)
  `).get(idOrNumber, idOrNumber.trim()) as any;

  if (!row) return null;

  // Optional privacy filter for public tracking by phone
  if (phone && row.customer_phone.replace(/\D/g, '') !== phone.replace(/\D/g, '')) {
    return null;
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(row.id) as any[];
  const payment = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(row.id) as any;

  return {
    id: row.id,
    orderNumber: row.order_number,
    customerId: row.customer_id || undefined,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email || undefined,
    items: items.map(i => ({
      id: i.id,
      productId: i.product_id,
      productNameSnapshot: i.product_name_snapshot,
      unitPrice: Number(i.unit_price),
      quantity: Number(i.quantity),
      subtotal: Number(i.subtotal),
      imageUrl: i.image_url || undefined,
      prescriptionRequired: Boolean(i.prescription_required),
      dosageForm: i.dosage_form || undefined,
    })),
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    total: Number(row.total),
    status: row.status as OrderStatus,
    paymentStatus: row.payment_status as PaymentStatus,
    fulfillmentMethod: row.fulfillment_method as 'pickup' | 'delivery',
    deliveryAddress: row.delivery_address || undefined,
    deliveryLandmark: row.delivery_landmark || undefined,
    notes: row.notes || undefined,
    prescriptionId: row.prescription_id || undefined,
    paymentDetails: payment
      ? {
          method: 'pochi_la_biashara',
          businessNumber: payment.business_number,
          amount: Number(payment.amount),
          transactionReference: payment.transaction_reference,
          proofUrl: payment.proof_file_id || undefined,
          paidAt: payment.created_at,
          verifiedBy: payment.verified_by || undefined,
          verifiedAt: payment.verified_at || undefined,
          notes: payment.notes || undefined,
        }
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getOrders(options?: {
  customerId?: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  search?: string;
  limit?: number;
  offset?: number;
}): { orders: Order[]; total: number } {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.customerId) {
    conditions.push('o.customer_id = ?');
    params.push(options.customerId);
  }

  if (options?.status) {
    conditions.push('o.status = ?');
    params.push(options.status);
  }

  if (options?.paymentStatus) {
    conditions.push('o.payment_status = ?');
    params.push(options.paymentStatus);
  }

  if (options?.search) {
    const q = `%${options.search.toLowerCase().trim()}%`;
    conditions.push('(LOWER(o.order_number) LIKE ? OR LOWER(o.customer_name) LIKE ? OR o.customer_phone LIKE ?)');
    params.push(q, q, q);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRow = db.prepare(`SELECT COUNT(*) as count FROM orders o ${where}`).get(...params) as { count: number };
  const total = countRow.count;

  const limit = options?.limit || 100;
  const offset = options?.offset || 0;

  const rows = db.prepare(`
    SELECT o.id FROM orders o
    ${where}
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<{ id: string }>;

  const orders: Order[] = [];
  for (const r of rows) {
    const ord = getOrderByNumberOrId(r.id);
    if (ord) orders.push(ord);
  }

  return { orders, total };
}

export function submitOrderPayment(
  orderId: string,
  transactionReference: string,
  proofUrl?: string
): Order {
  const db = getDatabase();
  const order = getOrderByNumberOrId(orderId);
  if (!order) throw new Error('Order not found.');

  if (!transactionReference || transactionReference.trim().length < 4) {
    throw new Error('Valid M-Pesa / Pochi transaction confirmation code is required.');
  }

  const cleanRef = transactionReference.trim().toUpperCase();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO payments (id, order_id, method, business_number, amount, transaction_reference, proof_file_id, status, created_at, updated_at)
    VALUES (?, ?, 'pochi_la_biashara', '07417758578', ?, ?, ?, 'submitted', ?, ?)
    ON CONFLICT(transaction_reference) DO UPDATE SET
      proof_file_id = COALESCE(excluded.proof_file_id, payments.proof_file_id),
      updated_at = excluded.updated_at
  `).run(`pay-${crypto.randomUUID()}`, order.id, order.total, cleanRef, proofUrl || null, now, now);

  db.prepare(`
    UPDATE orders SET status = 'payment_submitted', payment_status = 'submitted', updated_at = ?
    WHERE id = ?
  `).run(now, order.id);

  const updatedOrder = getOrderByNumberOrId(order.id)!;

  realtimeService.broadcastToStaff('payment:submitted', { order: updatedOrder });
  realtimeService.broadcastToStaff('payment_submitted', { order: updatedOrder });
  if (order.customerId) {
    realtimeService.broadcastToUser(order.customerId, 'order:status_updated', { order: updatedOrder });
    realtimeService.broadcastToUser(order.customerId, 'order_status_updated', { order: updatedOrder });
  }

  logAudit(
    { id: order.customerId || 'guest', name: order.customerName, role: 'customer' },
    'PAYMENT_SUBMITTED',
    'payment',
    order.id,
    `Payment submitted for ${order.orderNumber}. Ref: ${cleanRef}`
  );

  return updatedOrder;
}

export function verifyOrderPayment(
  orderId: string,
  status: 'verified' | 'rejected',
  notes: string,
  staff: { id: string; name: string; role: string }
): Order {
  const db = getDatabase();
  const order = getOrderByNumberOrId(orderId);
  if (!order) throw new Error('Order not found.');

  const now = new Date().toISOString();
  const nextOrderStatus: OrderStatus = status === 'verified' ? 'processing' : 'awaiting_payment';
  const nextPaymentStatus: PaymentStatus = status === 'verified' ? 'verified' : 'failed';

  db.prepare(`
    UPDATE payments SET
      status = ?,
      verified_by = ?,
      verified_at = ?,
      notes = ?,
      updated_at = ?
    WHERE order_id = ?
  `).run(status, staff.name, now, notes, now, order.id);

  db.prepare(`
    UPDATE orders SET status = ?, payment_status = ?, updated_at = ?
    WHERE id = ?
  `).run(nextOrderStatus, nextPaymentStatus, now, order.id);

  const updatedOrder = getOrderByNumberOrId(order.id)!;

  realtimeService.broadcastToStaff('payment:verified', { order: updatedOrder });
  realtimeService.broadcastToStaff('payment_verified', { order: updatedOrder });
  if (order.customerId) {
    realtimeService.broadcastToUser(order.customerId, 'order:status_updated', { order: updatedOrder });
    realtimeService.broadcastToUser(order.customerId, 'order_status_updated', { order: updatedOrder });
  }

  logAudit(
    staff,
    status === 'verified' ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED',
    'payment',
    order.id,
    `Payment for order ${order.orderNumber} ${status.toUpperCase()}. Notes: ${notes}`
  );

  return updatedOrder;
}

export function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  staff: { id: string; name: string; role: string },
  staffNotes?: string
): Order {
  const db = getDatabase();
  const order = getOrderByNumberOrId(orderId);
  if (!order) throw new Error('Order not found.');

  const now = new Date().toISOString();
  const updatedNotes = staffNotes
    ? order.notes ? `${order.notes}\n[Staff Note: ${staffNotes}]` : `[Staff Note: ${staffNotes}]`
    : order.notes;

  db.prepare('UPDATE orders SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(status, updatedNotes || null, now, order.id);

  const updatedOrder = getOrderByNumberOrId(order.id)!;

  realtimeService.broadcastToStaff('order:status_updated', { order: updatedOrder });
  realtimeService.broadcastToStaff('order_status_updated', { order: updatedOrder });
  if (order.customerId) {
    realtimeService.broadcastToUser(order.customerId, 'order:status_updated', { order: updatedOrder });
    realtimeService.broadcastToUser(order.customerId, 'order_status_updated', { order: updatedOrder });
  }

  logAudit(
    staff,
    'ORDER_STATUS_UPDATED',
    'order',
    order.id,
    `Order ${order.orderNumber} status updated to ${status}.`
  );

  return updatedOrder;
}

// ----------------- PRESCRIPTIONS -----------------

export function createPrescription(data: {
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
  notes?: string;
  medicationsRequested?: string;
  doctorName?: string;
  hospitalName?: string;
}): Prescription {
  const db = getDatabase();

  if (!data.customerName || !data.customerPhone) {
    throw new Error('Patient name and contact phone number are required.');
  }

  if (!data.fileUrl) {
    throw new Error('Prescription file or document image is required.');
  }

  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const prescriptionNumber = `RX-2026-${randomNum}`;
  const id = `rx-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO prescriptions (
      id, prescription_number, customer_id, customer_name, customer_phone, customer_email,
      file_url, file_name, file_type, file_size, notes, medications_requested, doctor_name, hospital_name,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?)
  `).run(
    id,
    prescriptionNumber,
    data.customerId || null,
    data.customerName.trim(),
    data.customerPhone.trim(),
    data.customerEmail?.trim() || null,
    data.fileUrl,
    data.fileName,
    data.fileType,
    data.fileSize || 0,
    data.notes?.trim() || null,
    data.medicationsRequested?.trim() || null,
    data.doctorName?.trim() || null,
    data.hospitalName?.trim() || null,
    now,
    now
  );

  const prescription: Prescription = {
    id,
    prescriptionNumber,
    customerId: data.customerId,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerEmail: data.customerEmail,
    fileUrl: data.fileUrl,
    fileName: data.fileName,
    fileType: data.fileType,
    fileSize: data.fileSize,
    notes: data.notes,
    medicationsRequested: data.medicationsRequested,
    doctorName: data.doctorName,
    hospitalName: data.hospitalName,
    status: 'pending_review',
    createdAt: now,
    updatedAt: now,
  };

  realtimeService.broadcastToStaff('prescription:new', { prescription });
  realtimeService.broadcastToStaff('prescription_submitted', { prescription });
  if (data.customerId) {
    realtimeService.broadcastToUser(data.customerId, 'prescription:updated', { prescription });
    realtimeService.broadcastToUser(data.customerId, 'prescription_updated', { prescription });
  }

  logAudit(
    { id: data.customerId || 'guest', name: data.customerName, role: 'customer' },
    'PRESCRIPTION_SUBMITTED',
    'prescription',
    id,
    `Prescription ${prescriptionNumber} uploaded for pharmacist review.`
  );

  return prescription;
}

export function reviewPrescription(
  prescriptionId: string,
  status: PrescriptionStatus,
  reviewNotes: string,
  staff: { id: string; name: string; role: string }
): Prescription {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(prescriptionId) as any;
  if (!row) throw new Error('Prescription not found.');

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE prescriptions SET
      status = ?,
      review_notes = ?,
      reviewed_by = ?,
      reviewed_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(status, reviewNotes || '', staff.name, now, now, prescriptionId);

  const updated = getPrescriptions({ customerId: row.customer_id, status: undefined }).find(p => p.id === prescriptionId)!;

  realtimeService.broadcastToStaff('prescription:reviewed', { prescription: updated });
  realtimeService.broadcastToStaff('prescription_reviewed', { prescription: updated });
  if (row.customer_id) {
    realtimeService.broadcastToUser(row.customer_id, 'prescription:updated', { prescription: updated });
    realtimeService.broadcastToUser(row.customer_id, 'prescription_updated', { prescription: updated });
  }

  logAudit(
    staff,
    'PRESCRIPTION_REVIEWED',
    'prescription',
    prescriptionId,
    `Prescription ${row.prescription_number} marked as ${status}. Review notes: ${reviewNotes}`
  );

  return updated;
}

export function getPrescriptions(options?: {
  customerId?: string;
  status?: PrescriptionStatus;
}): Prescription[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.customerId) {
    conditions.push('customer_id = ?');
    params.push(options.customerId);
  }

  if (options?.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM prescriptions ${where} ORDER BY created_at DESC`).all(...params) as any[];

  return rows.map(r => ({
    id: r.id,
    prescriptionNumber: r.prescription_number,
    customerId: r.customer_id || undefined,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    customerEmail: r.customer_email || undefined,
    fileUrl: r.file_url,
    fileName: r.file_name,
    fileType: r.file_type,
    fileSize: r.file_size || undefined,
    notes: r.notes || undefined,
    medicationsRequested: r.medications_requested || undefined,
    doctorName: r.doctor_name || undefined,
    hospitalName: r.hospital_name || undefined,
    status: r.status as PrescriptionStatus,
    reviewNotes: r.review_notes || undefined,
    reviewedBy: r.reviewed_by || undefined,
    reviewedAt: r.reviewed_at || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ----------------- APPOINTMENTS -----------------

export function createAppointment(data: {
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  serviceId: string;
  appointmentDate: string;
  appointmentTime: string;
  notes?: string;
}): Appointment {
  const db = getDatabase();

  if (!data.customerName || !data.customerPhone || !data.serviceId || !data.appointmentDate || !data.appointmentTime) {
    throw new Error('Patient name, phone, clinical service, date, and preferred time are required.');
  }

  const srv = db.prepare('SELECT name FROM services WHERE id = ?').get(data.serviceId) as any;
  const serviceName = srv ? srv.name : 'General Pharmacy Consultation';

  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const appointmentNumber = `APT-2026-${randomNum}`;
  const id = `apt-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO appointments (
      id, appointment_number, customer_id, customer_name, customer_phone, customer_email,
      service_id, service_name, appointment_date, appointment_time, notes, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    appointmentNumber,
    data.customerId || null,
    data.customerName.trim(),
    data.customerPhone.trim(),
    data.customerEmail?.trim() || null,
    data.serviceId,
    serviceName,
    data.appointmentDate,
    data.appointmentTime,
    data.notes?.trim() || null,
    now,
    now
  );

  const appointment: Appointment = {
    id,
    appointmentNumber,
    customerId: data.customerId,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerEmail: data.customerEmail,
    serviceId: data.serviceId,
    serviceName,
    appointmentDate: data.appointmentDate,
    appointmentTime: data.appointmentTime,
    notes: data.notes,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  realtimeService.broadcastToStaff('appointment:new', { appointment });
  realtimeService.broadcastToStaff('appointment_created', { appointment });
  if (data.customerId) {
    realtimeService.broadcastToUser(data.customerId, 'appointment:status_updated', { appointment });
    realtimeService.broadcastToUser(data.customerId, 'appointment_updated', { appointment });
  }

  logAudit(
    { id: data.customerId || 'guest', name: data.customerName, role: 'customer' },
    'APPOINTMENT_REQUESTED',
    'appointment',
    id,
    `Appointment ${appointmentNumber} requested for ${serviceName} on ${data.appointmentDate} at ${data.appointmentTime}.`
  );

  return appointment;
}

export function updateAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
  staffNotes: string | undefined,
  staff: { id: string; name: string; role: string }
): Appointment {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId) as any;
  if (!row) throw new Error('Appointment not found.');

  const now = new Date().toISOString();
  db.prepare('UPDATE appointments SET status = ?, staff_notes = ?, reviewed_by = ?, updated_at = ? WHERE id = ?')
    .run(status, staffNotes || null, staff.name, now, appointmentId);

  const updated = getAppointments({ customerId: row.customer_id }).find(a => a.id === appointmentId)!;

  realtimeService.broadcastToStaff('appointment:status_updated', { appointment: updated });
  realtimeService.broadcastToStaff('appointment_updated', { appointment: updated });
  if (row.customer_id) {
    realtimeService.broadcastToUser(row.customer_id, 'appointment:status_updated', { appointment: updated });
    realtimeService.broadcastToUser(row.customer_id, 'appointment_updated', { appointment: updated });
  }

  logAudit(
    staff,
    'APPOINTMENT_UPDATED',
    'appointment',
    appointmentId,
    `Appointment ${row.appointment_number} marked as ${status}.`
  );

  return updated;
}

export function getAppointments(options?: { customerId?: string; status?: AppointmentStatus }): Appointment[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.customerId) {
    conditions.push('customer_id = ?');
    params.push(options.customerId);
  }

  if (options?.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM appointments ${where} ORDER BY appointment_date ASC, appointment_time ASC`).all(...params) as any[];

  return rows.map(r => ({
    id: r.id,
    appointmentNumber: r.appointment_number,
    customerId: r.customer_id || undefined,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    customerEmail: r.customer_email || undefined,
    serviceId: r.service_id,
    serviceName: r.service_name,
    appointmentDate: r.appointment_date,
    appointmentTime: r.appointment_time,
    notes: r.notes || undefined,
    status: r.status as AppointmentStatus,
    staffNotes: r.staff_notes || undefined,
    reviewedBy: r.reviewed_by || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ----------------- SERVICES, ARTICLES, CONTACT -----------------

export function getServices(): PharmacyService[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM services WHERE available = 1 ORDER BY featured DESC, name ASC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    shortDescription: r.short_description || '',
    fullDescription: r.full_description || '',
    priceEstimate: r.price_estimate || '',
    duration: r.duration || '',
    iconName: r.icon_name || 'Activity',
    category: r.category || 'General',
    available: Boolean(r.available),
    featured: Boolean(r.featured),
    createdAt: r.created_at,
  }));
}

export function getAllServicesAdmin(): PharmacyService[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM services ORDER BY featured DESC, name ASC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    shortDescription: r.short_description || '',
    fullDescription: r.full_description || '',
    priceEstimate: r.price_estimate || '',
    duration: r.duration || '',
    iconName: r.icon_name || 'Activity',
    category: r.category || 'General',
    available: Boolean(r.available),
    featured: Boolean(r.featured),
    createdAt: r.created_at,
  }));
}

export function saveService(serviceData: Partial<PharmacyService>, actor: { id: string; name: string; role: string }): PharmacyService {
  const db = getDatabase();
  const now = new Date().toISOString();

  if (serviceData.id) {
    db.prepare(`
      UPDATE services SET
        name = COALESCE(?, name),
        slug = COALESCE(?, slug),
        short_description = COALESCE(?, short_description),
        full_description = COALESCE(?, full_description),
        price_estimate = COALESCE(?, price_estimate),
        duration = COALESCE(?, duration),
        icon_name = COALESCE(?, icon_name),
        category = COALESCE(?, category),
        available = COALESCE(?, available),
        featured = COALESCE(?, featured)
      WHERE id = ?
    `).run(
      serviceData.name || null,
      serviceData.slug || null,
      serviceData.shortDescription || null,
      serviceData.fullDescription || null,
      serviceData.priceEstimate || null,
      serviceData.duration || null,
      serviceData.iconName || null,
      serviceData.category || null,
      serviceData.available !== undefined ? (serviceData.available ? 1 : 0) : null,
      serviceData.featured !== undefined ? (serviceData.featured ? 1 : 0) : null,
      serviceData.id
    );
    logAudit(actor, 'SERVICE_UPDATED', 'service', serviceData.id, `Updated service ${serviceData.name}`);
    return getAllServicesAdmin().find(s => s.id === serviceData.id)!;
  } else {
    const id = `srv-${crypto.randomUUID()}`;
    const slug = serviceData.slug || serviceData.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'service';
    db.prepare(`
      INSERT INTO services (id, name, slug, short_description, full_description, price_estimate, duration, icon_name, category, available, featured, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      serviceData.name || 'New Clinical Service',
      slug,
      serviceData.shortDescription || '',
      serviceData.fullDescription || '',
      serviceData.priceEstimate || 'Contact for price',
      serviceData.duration || '15 mins',
      serviceData.iconName || 'Activity',
      serviceData.category || 'General',
      serviceData.available !== undefined ? (serviceData.available ? 1 : 0) : 1,
      serviceData.featured ? 1 : 0,
      now
    );
    logAudit(actor, 'SERVICE_CREATED', 'service', id, `Created clinical service ${serviceData.name}`);
    return getAllServicesAdmin().find(s => s.id === id)!;
  }
}

export function getArticles(): HealthArticle[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM health_articles WHERE published = 1 ORDER BY published_date DESC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt || '',
    content: r.content || '',
    category: r.category || 'Health Education',
    author: r.author || 'Gods Favor Pharmacy Team',
    readTime: r.read_time || '4 min read',
    publishedDate: r.published_date,
    imageUrl: r.image_url || '',
    tags: JSON.parse(r.tags_json || '[]'),
    published: Boolean(r.published),
    createdAt: r.created_at,
  }));
}

export function getArticleBySlug(slug: string): HealthArticle | null {
  const db = getDatabase();
  const r = db.prepare('SELECT * FROM health_articles WHERE slug = ? AND published = 1').get(slug) as any;
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt || '',
    content: r.content || '',
    category: r.category || 'Health Education',
    author: r.author || 'Gods Favor Pharmacy Team',
    readTime: r.read_time || '4 min read',
    publishedDate: r.published_date,
    imageUrl: r.image_url || '',
    tags: JSON.parse(r.tags_json || '[]'),
    published: Boolean(r.published),
    createdAt: r.created_at,
  };
}

export function saveArticle(articleData: Partial<HealthArticle>, actor: { id: string; name: string; role: string }): HealthArticle {
  const db = getDatabase();
  const now = new Date().toISOString();

  if (articleData.id) {
    db.prepare(`
      UPDATE health_articles SET
        title = COALESCE(?, title),
        slug = COALESCE(?, slug),
        excerpt = COALESCE(?, excerpt),
        content = COALESCE(?, content),
        category = COALESCE(?, category),
        author = COALESCE(?, author),
        read_time = COALESCE(?, read_time),
        published_date = COALESCE(?, published_date),
        image_url = COALESCE(?, image_url),
        tags_json = COALESCE(?, tags_json),
        published = COALESCE(?, published)
      WHERE id = ?
    `).run(
      articleData.title || null,
      articleData.slug || null,
      articleData.excerpt || null,
      articleData.content || null,
      articleData.category || null,
      articleData.author || null,
      articleData.readTime || null,
      articleData.publishedDate || null,
      articleData.imageUrl || null,
      articleData.tags ? JSON.stringify(articleData.tags) : null,
      articleData.published !== undefined ? (articleData.published ? 1 : 0) : null,
      articleData.id
    );
    return getArticleBySlug(articleData.slug || '') || getArticles()[0];
  } else {
    const id = `art-${crypto.randomUUID()}`;
    const slug = articleData.slug || articleData.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'article';
    db.prepare(`
      INSERT INTO health_articles (id, title, slug, excerpt, content, category, author, read_time, published_date, image_url, tags_json, published, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      articleData.title || 'Untitled Article',
      slug,
      articleData.excerpt || '',
      articleData.content || '',
      articleData.category || 'Health Education',
      articleData.author || 'Gods Favor Pharmacy Clinical Team',
      articleData.readTime || '4 min read',
      articleData.publishedDate || now.split('T')[0],
      articleData.imageUrl || '',
      JSON.stringify(articleData.tags || ['Health', 'Kitale']),
      articleData.published !== undefined ? (articleData.published ? 1 : 0) : 1,
      now
    );
    return getArticleBySlug(slug)!;
  }
}

export function createContactMessage(data: {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}): ContactMessage {
  const db = getDatabase();

  if (!data.name || !data.phone || !data.message) {
    throw new Error('Name, phone number, and message are required.');
  }

  const id = `msg-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO contact_messages (id, name, email, phone, subject, message, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'unread', ?)
  `).run(id, data.name.trim(), data.email?.trim() || null, data.phone.trim(), data.subject?.trim() || 'General Inquiry', data.message.trim(), now);

  const contactMessage: ContactMessage = {
    id,
    name: data.name,
    email: data.email,
    phone: data.phone,
    subject: data.subject,
    message: data.message,
    status: 'unread',
    createdAt: now,
  };

  realtimeService.broadcastToStaff('contact_message_received', { contactMessage });
  return contactMessage;
}

export function getContactMessages(): ContactMessage[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    email: r.email || '',
    phone: r.phone,
    subject: r.subject || 'General Inquiry',
    message: r.message,
    status: r.status as 'unread' | 'read' | 'replied',
    replyNotes: r.reply_notes || undefined,
    repliedBy: r.replied_by || undefined,
    createdAt: r.created_at,
  }));
}

export function updateContactMessageStatus(id: string, status: 'unread' | 'read' | 'replied', replyNotes?: string): ContactMessage {
  const db = getDatabase();
  db.prepare('UPDATE contact_messages SET status = ?, reply_notes = ? WHERE id = ?').run(status, replyNotes || null, id);
  return getContactMessages().find(m => m.id === id)!;
}

// ----------------- SETTINGS, METRICS & AUDIT LOGS -----------------

export function getSettings(): PharmacySettings {
  const db = getDatabase();
  const row = db.prepare('SELECT value_json FROM pharmacy_settings WHERE key = ?').get('general') as any;
  if (row) {
    try {
      return JSON.parse(row.value_json);
    } catch {
      // fallback
    }
  }
  return initialSettings;
}

export function updateSettings(settingsData: Partial<PharmacySettings>, actor: { id: string; name: string; role: string }): PharmacySettings {
  const db = getDatabase();
  const current = getSettings();
  const merged = { ...current, ...settingsData };
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO pharmacy_settings (id, key, value_json, updated_at)
    VALUES ('setting-global', 'general', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(JSON.stringify(merged), now);

  logAudit(actor, 'SETTINGS_UPDATED', 'settings', 'general', 'Updated pharmacy business settings and operating hours.');
  return merged;
}

export function getAdminMetrics(): {
  todayOrdersCount: number;
  pendingOrdersCount: number;
  pendingPaymentsCount: number;
  pendingPrescriptionsCount: number;
  upcomingAppointmentsCount: number;
  lowStockCount: number;
  totalRevenue: number;
  recentOrders: Order[];
  recentAuditLogs: AuditLog[];
} {
  const db = getDatabase();
  const todayStr = new Date().toISOString().split('T')[0];

  const todayOrders = (db.prepare('SELECT COUNT(*) as count FROM orders WHERE created_at LIKE ?').get(`${todayStr}%`) as any).count;
  const pendingOrders = (db.prepare("SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'awaiting_payment', 'payment_submitted')").get() as any).count;
  const pendingPayments = (db.prepare("SELECT COUNT(*) as count FROM payments WHERE status = 'submitted'").get() as any).count;
  const pendingPrescriptions = (db.prepare("SELECT COUNT(*) as count FROM prescriptions WHERE status = 'pending_review'").get() as any).count;
  const upcomingAppointments = (db.prepare("SELECT COUNT(*) as count FROM appointments WHERE status IN ('pending', 'confirmed')").get() as any).count;
  const lowStock = (db.prepare('SELECT COUNT(*) as count FROM products WHERE active = 1 AND stock_quantity <= 10').get() as any).count;

  const revenueRow = db.prepare("SELECT SUM(total) as revenue FROM orders WHERE payment_status = 'verified'").get() as any;
  const totalRevenue = revenueRow && revenueRow.revenue ? Number(revenueRow.revenue) : 0;

  const { orders: recentOrders } = getOrders({ limit: 10 });
  const recentAuditLogs = getAuditLogs().slice(0, 15);

  return {
    todayOrdersCount: todayOrders,
    pendingOrdersCount: pendingOrders,
    pendingPaymentsCount: pendingPayments,
    pendingPrescriptionsCount: pendingPrescriptions,
    upcomingAppointmentsCount: upcomingAppointments,
    lowStockCount: lowStock,
    totalRevenue,
    recentOrders,
    recentAuditLogs,
  };
}

export function getAuditLogs(): AuditLog[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500').all() as any[];
  return rows.map(r => ({
    id: r.id,
    actorId: r.actor_id || 'system',
    actorName: r.actor_name,
    actorRole: r.actor_role,
    action: r.action,
    entityType: r.entity_type as any,
    entityId: r.entity_id || '',
    details: r.details,
    metadata: JSON.parse(r.metadata_json || '{}'),
    ipAddress: r.ip_address || undefined,
    userAgent: r.user_agent || undefined,
    createdAt: r.created_at,
  }));
}
