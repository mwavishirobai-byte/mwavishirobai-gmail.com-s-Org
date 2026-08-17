-- =========================================================
-- GODS FAVOR PHARMACY — PRODUCTION RELATIONAL SQL SCHEMA
-- Kitale Town, along Kijana Wamalwa Road, Kitale, Kenya
-- =========================================================

PRAGMA foreign_keys = ON;

-- 1. ROLES TABLE
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. PERMISSIONS TABLE
CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL
);

-- 3. ROLE PERMISSIONS MAPPING
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- 4. USER PROFILES
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

-- 5. USER PASSWORDS
CREATE TABLE IF NOT EXISTS user_passwords (
  profile_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- 6. USER SESSIONS
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

-- 7. CATEGORIES
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

-- 8. PRODUCTS
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

-- 9. INVENTORY AUDIT LOGS
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

-- 10. ORDERS
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

-- 11. ORDER ITEMS
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

-- 12. PAYMENTS
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

-- 13. PRESCRIPTIONS
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

-- 14. APPOINTMENTS
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

-- 15. SERVICES
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

-- 16. HEALTH ARTICLES
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

-- 17. CONTACT MESSAGES
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

-- 18. AUDIT LOGS
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

-- 19. PHARMACY SETTINGS (Key-Value JSON store)
CREATE TABLE IF NOT EXISTS pharmacy_settings (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 20. SECURE FILES TABLE
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
