import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import {
  initialSettings,
  initialCategories,
  initialProducts,
  initialServices,
  initialArticles,
} from '../seedData';

const SCHEMA_SQL_FALLBACK = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'customer',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (role) REFERENCES roles(name) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);

CREATE TABLE IF NOT EXISTS user_passwords (
  profile_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_profile ON user_sessions(profile_id);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon_name TEXT DEFAULT 'Pill',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  category_id TEXT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  sku TEXT UNIQUE NOT NULL,
  brand TEXT DEFAULT 'Generic',
  price REAL NOT NULL,
  discount_price REAL,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  prescription_required INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  dosage_form TEXT DEFAULT 'Tablets',
  active_ingredient TEXT DEFAULT '',
  pack_size TEXT DEFAULT 'Standard Pack',
  instructions TEXT DEFAULT '',
  warnings TEXT DEFAULT '',
  storage_info TEXT DEFAULT '',
  is_featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);

CREATE TABLE IF NOT EXISTS inventory_logs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  change_amount INTEGER NOT NULL,
  previous_quantity INTEGER NOT NULL,
  new_quantity INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_logs(product_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  subtotal REAL NOT NULL,
  delivery_fee REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_payment',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  fulfillment_method TEXT NOT NULL DEFAULT 'pickup',
  delivery_address TEXT,
  delivery_landmark TEXT,
  notes TEXT,
  prescription_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_id TEXT,
  product_name_snapshot TEXT NOT NULL,
  unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal REAL NOT NULL,
  image_url TEXT,
  prescription_required INTEGER NOT NULL DEFAULT 0,
  dosage_form TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'pochi_la_biashara',
  business_number TEXT NOT NULL DEFAULT '07417758578',
  amount REAL NOT NULL,
  transaction_reference TEXT UNIQUE NOT NULL,
  proof_file_id TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  verified_by TEXT,
  verified_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(transaction_reference);

CREATE TABLE IF NOT EXISTS prescriptions (
  id TEXT PRIMARY KEY,
  prescription_number TEXT UNIQUE NOT NULL,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  notes TEXT,
  medications_requested TEXT,
  doctor_name TEXT,
  hospital_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  review_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_prescriptions_number ON prescriptions(prescription_number);
CREATE INDEX IF NOT EXISTS idx_prescriptions_customer ON prescriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_status ON prescriptions(status);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  appointment_number TEXT UNIQUE NOT NULL,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  service_id TEXT,
  service_name TEXT NOT NULL,
  appointment_date TEXT NOT NULL,
  appointment_time TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  staff_notes TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_appointments_number ON appointments(appointment_number);
CREATE INDEX IF NOT EXISTS idx_appointments_customer ON appointments(customer_id);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  short_description TEXT DEFAULT '',
  full_description TEXT DEFAULT '',
  price_estimate TEXT DEFAULT 'Contact for price',
  duration TEXT DEFAULT '15 mins',
  icon_name TEXT DEFAULT 'Activity',
  category TEXT DEFAULT 'General',
  available INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS health_articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  excerpt TEXT DEFAULT '',
  content TEXT DEFAULT '',
  category TEXT DEFAULT 'Health Education',
  author TEXT DEFAULT 'Gods Favor Pharmacy Clinical Team',
  read_time TEXT DEFAULT '4 min read',
  published_date TEXT NOT NULL,
  image_url TEXT,
  tags_json TEXT DEFAULT '[]',
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_slug ON health_articles(slug);

CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  subject TEXT DEFAULT 'General Inquiry',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread',
  reply_notes TEXT,
  replied_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS pharmacy_settings (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS secure_files (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  file_type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  is_private INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function getDatabasePath(): string {
  // If running in Vercel or read-only lambda environment, use /tmp
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return '/tmp/gods_favor_pharmacy.sqlite';
  }

  const localDataDir = path.join(process.cwd(), 'data');
  try {
    if (!fs.existsSync(localDataDir)) {
      fs.mkdirSync(localDataDir, { recursive: true });
    }
    // Test write permission
    const testFile = path.join(localDataDir, '.write_test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return path.join(localDataDir, 'gods_favor_pharmacy.sqlite');
  } catch {
    // Read-only filesystem fallback
    return '/tmp/gods_favor_pharmacy.sqlite';
  }
}

const SCHEMA_FILE = path.join(process.cwd(), 'server', 'db', 'schema.sql');
const LEGACY_JSON_FILE = path.join(process.cwd(), 'data', 'pharmacy_database.json');

let db: DatabaseSync | null = null;

export function getDatabase(): DatabaseSync {
  if (db) {
    return db;
  }

  const dbPath = getDatabasePath();

  try {
    db = openDatabaseInstance(dbPath);
  } catch (err) {
    console.warn(`Database open failed on ${dbPath}. Attempting clean rebuild:`, err);
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
    } catch {
      // ignore
    }
    db = openDatabaseInstance(dbPath);
  }

  return db;
}

function openDatabaseInstance(dbPath: string): DatabaseSync {
  const instance = new DatabaseSync(dbPath);
  instance.exec('PRAGMA foreign_keys = ON;');
  try {
    instance.exec('PRAGMA journal_mode = WAL;');
    instance.exec('PRAGMA synchronous = NORMAL;');
  } catch {
    // Fallback if WAL is not permitted on the filesystem
    instance.exec('PRAGMA journal_mode = DELETE;');
  }

  initSchema(instance);
  seedRolesAndPermissions(instance);
  migrateLegacyJsonIfNeeded(instance);

  return instance;
}

function initSchema(database: DatabaseSync) {
  try {
    if (fs.existsSync(SCHEMA_FILE)) {
      const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf-8');
      database.exec(schemaSql);
      return;
    }
  } catch {
    // Fallback to embedded schema
  }
  database.exec(SCHEMA_SQL_FALLBACK);
}

function seedRolesAndPermissions(database: DatabaseSync) {
  const roles = [
    { id: 'role-superadmin', name: 'super_admin', description: 'Complete system control and administration' },
    { id: 'role-admin', name: 'admin', description: 'Pharmacy director & store administrator' },
    { id: 'role-pharmacist', name: 'pharmacist', description: 'Licensed pharmacist reviewing prescriptions & dispensing' },
    { id: 'role-staff', name: 'staff', description: 'Pharmacy assistant & inventory handler' },
    { id: 'role-customer', name: 'customer', description: 'Patient & online customer' },
  ];

  const permissions = [
    { id: 'perm-orders-view', code: 'orders:view', description: 'View orders' },
    { id: 'perm-orders-update', code: 'orders:update_status', description: 'Update order status' },
    { id: 'perm-payments-verify', code: 'payments:verify', description: 'Verify customer payments' },
    { id: 'perm-rx-review', code: 'prescriptions:review', description: 'Review medical prescriptions' },
    { id: 'perm-inventory-manage', code: 'inventory:manage', description: 'Adjust product inventory' },
    { id: 'perm-products-manage', code: 'products:manage', description: 'Create and update products' },
    { id: 'perm-services-manage', code: 'services:manage', description: 'Manage clinical services' },
    { id: 'perm-appointments-manage', code: 'appointments:manage', description: 'Manage clinical appointments' },
    { id: 'perm-contact-manage', code: 'contact:manage', description: 'Manage customer contact messages' },
    { id: 'perm-articles-manage', code: 'articles:manage', description: 'Manage health education articles' },
    { id: 'perm-settings-manage', code: 'settings:manage', description: 'Update business settings' },
    { id: 'perm-audit-view', code: 'audit:view', description: 'View security audit logs' },
    { id: 'perm-staff-manage', code: 'staff:manage', description: 'Manage staff accounts' },
  ];

  const rolePermMap: Record<string, string[]> = {
    super_admin: permissions.map(p => p.code),
    admin: [
      'orders:view',
      'orders:update_status',
      'payments:verify',
      'prescriptions:review',
      'inventory:manage',
      'products:manage',
      'services:manage',
      'appointments:manage',
      'contact:manage',
      'articles:manage',
      'settings:manage',
      'audit:view',
      'staff:manage',
    ],
    pharmacist: [
      'orders:view',
      'orders:update_status',
      'payments:verify',
      'prescriptions:review',
      'inventory:manage',
      'products:manage',
      'services:manage',
      'appointments:manage',
      'contact:manage',
      'articles:manage',
    ],
    staff: [
      'orders:view',
      'orders:update_status',
      'payments:verify',
      'inventory:manage',
      'appointments:manage',
      'contact:manage',
    ],
    customer: [],
  };

  const insertRoleStmt = database.prepare('INSERT OR IGNORE INTO roles (id, name, description) VALUES (?, ?, ?)');
  for (const r of roles) {
    insertRoleStmt.run(r.id, r.name, r.description);
  }

  const insertPermStmt = database.prepare('INSERT OR IGNORE INTO permissions (id, code, description) VALUES (?, ?, ?)');
  for (const p of permissions) {
    insertPermStmt.run(p.id, p.code, p.description);
  }

  const roleRows = database.prepare('SELECT id, name FROM roles').all() as Array<{ id: string; name: string }>;
  const permRows = database.prepare('SELECT id, code FROM permissions').all() as Array<{ id: string; code: string }>;
  const roleIdMap = new Map(roleRows.map(r => [r.name, r.id]));
  const permIdMap = new Map(permRows.map(p => [p.code, p.id]));

  const insertRolePermStmt = database.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
  for (const [roleName, permCodes] of Object.entries(rolePermMap)) {
    const roleId = roleIdMap.get(roleName);
    if (!roleId) continue;
    for (const code of permCodes) {
      const permId = permIdMap.get(code);
      if (permId) {
        insertRolePermStmt.run(roleId, permId);
      }
    }
  }
}

function migrateLegacyJsonIfNeeded(database: DatabaseSync) {
  // Check if categories are already present
  const catCount = (database.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number }).count;
  if (catCount > 0) {
    return; // Already populated
  }

  console.log('Bootstrapping relational SQLite schema from catalog & seed data...');

  // 1. Initial Settings
  const insertSettingStmt = database.prepare('INSERT OR REPLACE INTO pharmacy_settings (id, key, value_json, updated_at) VALUES (?, ?, ?, ?)');
  insertSettingStmt.run('setting-global', 'general', JSON.stringify(initialSettings), new Date().toISOString());

  // 2. Categories
  const insertCatStmt = database.prepare(`
    INSERT OR REPLACE INTO categories (id, slug, name, description, icon_name, sort_order, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const cat of initialCategories) {
    insertCatStmt.run(
      cat.id,
      cat.slug,
      cat.name,
      cat.description || '',
      cat.iconName || 'Pill',
      cat.order || 0,
      cat.active ? 1 : 0,
      new Date().toISOString()
    );
  }

  // 3. Products
  const insertProdStmt = database.prepare(`
    INSERT OR REPLACE INTO products (
      id, category_id, name, slug, description, sku, brand, price, discount_price,
      stock_quantity, prescription_required, image_url, active, dosage_form,
      active_ingredient, pack_size, instructions, warnings, storage_info, is_featured,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of initialProducts) {
    insertProdStmt.run(
      p.id,
      p.categoryId,
      p.name,
      p.slug,
      p.description || '',
      p.sku,
      p.brand || 'Generic',
      p.price,
      p.discountPrice || null,
      p.stockQuantity,
      p.prescriptionRequired ? 1 : 0,
      p.imageUrl || '',
      p.active ? 1 : 0,
      p.dosageForm || 'Tablets',
      p.activeIngredient || '',
      p.packSize || 'Standard Pack',
      p.instructions || '',
      p.warnings || '',
      p.storageInfo || '',
      p.isFeatured ? 1 : 0,
      p.createdAt || new Date().toISOString(),
      p.updatedAt || new Date().toISOString()
    );
  }

  // 4. Services
  const insertSrvStmt = database.prepare(`
    INSERT OR REPLACE INTO services (
      id, name, slug, short_description, full_description, price_estimate, duration, icon_name, category, available, featured, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const s of initialServices) {
    insertSrvStmt.run(
      s.id,
      s.name,
      s.slug,
      s.shortDescription || '',
      s.fullDescription || '',
      s.priceEstimate || 'Contact for price',
      s.duration || '15 mins',
      s.iconName || 'Activity',
      s.category || 'General',
      s.available ? 1 : 0,
      s.featured ? 1 : 0,
      s.createdAt || new Date().toISOString()
    );
  }

  // 5. Health Articles
  const insertArtStmt = database.prepare(`
    INSERT OR REPLACE INTO health_articles (
      id, title, slug, excerpt, content, category, author, read_time, published_date, image_url, tags_json, published, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const a of initialArticles) {
    insertArtStmt.run(
      a.id,
      a.title,
      a.slug,
      a.excerpt || '',
      a.content || '',
      a.category || 'Health Education',
      a.author || 'Gods Favor Pharmacy Clinical Team',
      a.readTime || '4 min read',
      a.publishedDate || new Date().toISOString().split('T')[0],
      a.imageUrl || '',
      JSON.stringify(a.tags || ['Health', 'Kitale']),
      a.published ? 1 : 0,
      new Date().toISOString()
    );
  }

  // 6. Check if legacy JSON has orders, prescriptions, appointments, users to migrate
  if (fs.existsSync(LEGACY_JSON_FILE)) {
    try {
      const raw = fs.readFileSync(LEGACY_JSON_FILE, 'utf-8');
      const legacy = JSON.parse(raw);

      // Migrate Users
      if (Array.isArray(legacy.users)) {
        const insertProfile = database.prepare(`
          INSERT OR REPLACE INTO profiles (id, email, full_name, phone, address, role, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        `);
        const insertPass = database.prepare(`
          INSERT OR REPLACE INTO user_passwords (profile_id, password_hash, updated_at)
          VALUES (?, ?, ?)
        `);

        for (const u of legacy.users) {
          insertProfile.run(
            u.id,
            u.email.toLowerCase().trim(),
            u.fullName,
            u.phone,
            u.address || '',
            u.role || 'customer',
            u.createdAt || new Date().toISOString(),
            u.updatedAt || new Date().toISOString()
          );
          if (u.passwordHash) {
            insertPass.run(u.id, u.passwordHash, new Date().toISOString());
          }
        }
      }

      // Migrate Orders
      if (Array.isArray(legacy.orders)) {
        const insertOrder = database.prepare(`
          INSERT OR REPLACE INTO orders (
            id, order_number, customer_id, customer_name, customer_phone, customer_email,
            subtotal, delivery_fee, total, status, payment_status, fulfillment_method,
            delivery_address, delivery_landmark, notes, prescription_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertItem = database.prepare(`
          INSERT OR REPLACE INTO order_items (
            id, order_id, product_id, product_name_snapshot, unit_price, quantity, subtotal, image_url, prescription_required, dosage_form
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertPayment = database.prepare(`
          INSERT OR REPLACE INTO payments (
            id, order_id, method, business_number, amount, transaction_reference, proof_file_id, status, verified_by, verified_at, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const o of legacy.orders) {
          insertOrder.run(
            o.id,
            o.orderNumber,
            o.customerId || null,
            o.customerName,
            o.customerPhone,
            o.customerEmail || null,
            o.subtotal,
            o.deliveryFee || 0,
            o.total,
            o.status,
            o.paymentStatus,
            o.fulfillmentMethod || 'pickup',
            o.deliveryAddress || null,
            o.deliveryLandmark || null,
            o.notes || null,
            o.prescriptionId || null,
            o.createdAt,
            o.updatedAt
          );

          if (Array.isArray(o.items)) {
            for (const item of o.items) {
              insertItem.run(
                item.id || `item-${crypto.randomUUID()}`,
                o.id,
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
          }

          if (o.paymentDetails && o.paymentDetails.transactionReference) {
            insertPayment.run(
              `pay-${o.id}`,
              o.id,
              o.paymentDetails.method || 'pochi_la_biashara',
              o.paymentDetails.businessNumber || '07417758578',
              o.paymentDetails.amount || o.total,
              o.paymentDetails.transactionReference,
              o.paymentDetails.proofUrl || null,
              o.paymentStatus || 'submitted',
              o.paymentDetails.verifiedBy || null,
              o.paymentDetails.verifiedAt || null,
              o.paymentDetails.notes || null,
              o.paymentDetails.paidAt || o.createdAt,
              o.updatedAt
            );
          }
        }
      }

      // Migrate Prescriptions
      if (Array.isArray(legacy.prescriptions)) {
        const insertRx = database.prepare(`
          INSERT OR REPLACE INTO prescriptions (
            id, prescription_number, customer_id, customer_name, customer_phone, customer_email,
            file_url, file_name, file_type, file_size, notes, medications_requested, doctor_name, hospital_name,
            status, review_notes, reviewed_by, reviewed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const rx of legacy.prescriptions) {
          insertRx.run(
            rx.id,
            rx.prescriptionNumber,
            rx.customerId || null,
            rx.customerName,
            rx.customerPhone,
            rx.customerEmail || null,
            rx.fileUrl,
            rx.fileName || 'Prescription_Document',
            rx.fileType || 'image/jpeg',
            rx.fileSize || 0,
            rx.notes || null,
            rx.medicationsRequested || null,
            rx.doctorName || null,
            rx.hospitalName || null,
            rx.status || 'pending_review',
            rx.reviewNotes || null,
            rx.reviewedBy || null,
            rx.reviewedAt || null,
            rx.createdAt,
            rx.updatedAt
          );
        }
      }

      // Migrate Appointments
      if (Array.isArray(legacy.appointments)) {
        const insertApt = database.prepare(`
          INSERT OR REPLACE INTO appointments (
            id, appointment_number, customer_id, customer_name, customer_phone, customer_email,
            service_id, service_name, appointment_date, appointment_time, notes, status, staff_notes, reviewed_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const apt of legacy.appointments) {
          insertApt.run(
            apt.id,
            apt.appointmentNumber,
            apt.customerId || null,
            apt.customerName,
            apt.customerPhone,
            apt.customerEmail || null,
            apt.serviceId || null,
            apt.serviceName || 'General Consultation',
            apt.appointmentDate,
            apt.appointmentTime,
            apt.notes || null,
            apt.status || 'pending',
            apt.staffNotes || null,
            null,
            apt.createdAt,
            apt.updatedAt
          );
        }
      }

      // Migrate Audit Logs
      if (Array.isArray(legacy.auditLogs)) {
        const insertAudit = database.prepare(`
          INSERT OR REPLACE INTO audit_logs (id, actor_id, actor_name, actor_role, action, entity_type, entity_id, details, metadata_json, ip_address, user_agent, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const l of legacy.auditLogs) {
          insertAudit.run(
            l.id,
            l.actorId || 'system',
            l.actorName || 'System',
            l.actorRole || 'system',
            l.action,
            l.entityType || 'system',
            l.entityId || null,
            l.details,
            JSON.stringify(l.metadata || {}),
            null,
            null,
            l.createdAt || new Date().toISOString()
          );
        }
      }

      console.log('Successfully migrated legacy JSON database records into relational SQLite tables.');
    } catch (err) {
      console.warn('Error reading or migrating legacy JSON data:', err);
    }
  }

  // Ensure default staff and admin profiles exist
  const adminEmail = 'wekesavictor450@gmail.com';
  const adminPassword = process.env.ADMIN_PASSWORD;

  const adminProfile = database.prepare("SELECT id FROM profiles WHERE email = ? OR role = 'admin'").get(adminEmail) as { id: string } | undefined;

  if (!adminProfile) {
    const adminId = 'usr-admin-01';
    const insertProfile = database.prepare(`
      INSERT INTO profiles (id, email, full_name, phone, address, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'admin', 1, ?, ?)
    `);
    insertProfile.run(
      adminId,
      adminEmail,
      'Chief Pharmacist / Admin',
      '07417758578',
      'Kijana Wamalwa Road, Kitale',
      new Date().toISOString(),
      new Date().toISOString()
    );

    if (adminPassword) {
      const adminPassHash = bcrypt.hashSync(adminPassword, 10);
      const insertPass = database.prepare(`
        INSERT OR REPLACE INTO user_passwords (profile_id, password_hash, updated_at)
        VALUES (?, ?, ?)
      `);
      insertPass.run(adminId, adminPassHash, new Date().toISOString());
    }
  } else {
    // Sync email and ensure active
    database.prepare(`
      UPDATE profiles
      SET email = ?, role = 'admin', is_active = 1, updated_at = ?
      WHERE id = ?
    `).run(adminEmail, new Date().toISOString(), adminProfile.id);

    if (adminPassword) {
      const adminPassHash = bcrypt.hashSync(adminPassword, 10);
      database.prepare(`
        INSERT OR REPLACE INTO user_passwords (profile_id, password_hash, updated_at)
        VALUES (?, ?, ?)
      `).run(adminProfile.id, adminPassHash, new Date().toISOString());
    }
  }

  // Ensure pharmacist profile exists
  const pharmProfile = database.prepare("SELECT id FROM profiles WHERE role = 'pharmacist'").get() as { id: string } | undefined;
  if (!pharmProfile) {
    const pharmId = 'usr-pharm-01';
    const insertProfile = database.prepare(`
      INSERT INTO profiles (id, email, full_name, phone, address, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pharmacist', 1, ?, ?)
    `);
    insertProfile.run(
      pharmId,
      'pharmacist@godsfavorpharmacy.ke',
      'Clinical Pharmacist on Duty',
      '07417758578',
      'Kitale Town',
      new Date().toISOString(),
      new Date().toISOString()
    );
  }
}
