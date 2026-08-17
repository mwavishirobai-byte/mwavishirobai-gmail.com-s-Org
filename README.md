# Gods Favor Pharmacy — Production Deployment & Configuration

**Gods Favor Pharmacy** is a full-stack digital pharmacy platform serving Kitale Town, Kenya (along Kijana Wamalwa Road). The platform provides medicine browsing, prescription uploads, appointment scheduling, health consultations, and M-Pesa / Pochi la Biashara payment verification.

---

## Vercel Deployment & Environment Variables Configuration

When deploying the application to **Vercel**, environment variables must be configured under **Project Settings > Environment Variables**.

Understanding the boundary between **Client-Side (Browser-Safe)** variables and **Server-Only (Protected Secrets)** is critical for system security and Row Level Security (RLS) integrity.

---

### 1. The Security Boundary: Public Supabase Keys vs. Server-Only JWT_SECRET

| Concept | `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | `JWT_SECRET` |
| :--- | :--- | :--- |
| **Purpose** | Authenticates anonymous/client requests to Supabase APIs. | Cryptographically signs and validates backend session tokens. |
| **Scope** | **Public / Browser-Safe** | **Strictly Server-Only (Private)** |
| **Exposure** | Expected to be visible in client bundles; protected by **Row Level Security (RLS)** in the database. | Must **NEVER** be exposed in client code, network headers, or Vite bundles. |
| **Prefix** | Can be prefixed with `VITE_` for browser SDKs. | **NEVER** prefix with `VITE_`. |
| **Fail-Safe** | Provided by Supabase dashboard. | Backend enforces minimum 32 characters; fails startup if missing. |

> ⚠️ **CRITICAL SECURITY DIRECTIVE:**
> - **Never** substitute `JWT_SECRET` with `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`.
> - **Never** put `SUPABASE_SERVICE_ROLE_KEY` into a `VITE_*` variable, as it bypasses all Supabase Row Level Security.
> - `JWT_SECRET` is an independent server secret that ensures session tokens and revocation lists remain strictly controlled by the backend.

---

### 2. Environment Variables Reference Matrix

| Variable Name | Required | Target Runtime | Purpose |
| :--- | :--- | :--- | :--- |
| `JWT_SECRET` | **YES (Mandatory)** | **Serverless / Node.js Only** | Backend session token signing key. Must be a random string $\ge$ 32 characters. |
| `SUPABASE_URL` | Optional / Recommended | Serverless / Node.js | Supabase Project API URL (`https://<project-ref>.supabase.co`). |
| `SUPABASE_ANON_KEY` | Optional / Recommended | Serverless / Node.js | Supabase public anonymous key for server-side API requests. |
| `VITE_SUPABASE_URL` | Optional (if using client SDK) | Client-Side (Vite Bundle) | Supabase Project API URL exposed to the frontend. |
| `VITE_SUPABASE_ANON_KEY` | Optional (if using client SDK) | Client-Side (Vite Bundle) | Public client key for direct frontend queries under RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional (Admin only) | **Serverless / Node.js Only** | Privileged key for administrative server tasks bypassing RLS. |
| `DATABASE_URL` | Optional (Postgres direct) | **Serverless / Node.js Only** | PostgreSQL connection pooler string (Port 6543/5432). |
| `GEMINI_API_KEY` | Optional (AI features) | **Serverless / Node.js Only** | Google AI Studio Gemini API key for clinical assistance. |
| `NODE_ENV` | Recommended | Build & Server | Set to `production` in Vercel. |

---

### 3. Step-by-Step Vercel Setup Guide

1. **Import the Project into Vercel**:
   - Connect your Git repository to Vercel.
   - Framework Preset: **Vite** (or Other).
   - Build Command: `npm run build`
   - Output Directory: `dist`

2. **Add Required Environment Variables in Vercel Dashboard**:
   - Go to your Project in Vercel $\rightarrow$ **Settings** $\rightarrow$ **Environment Variables**.
   - Add the following key-value pairs for **Production**, **Preview**, and **Development** environments:

```env
# -------------------------------------------------------------
# 1. CORE SERVER-SIDE AUTHENTICATION SECRET (MANDATORY)
# -------------------------------------------------------------
# Generate a high-entropy 32+ character random secret:
JWT_SECRET=your_32_character_minimum_random_secret_here

# -------------------------------------------------------------
# 2. SUPABASE CREDENTIALS (IF CONNECTING SUPABASE)
# -------------------------------------------------------------
# Server-side Supabase credentials:
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-public-key

# Client-side Supabase credentials (if direct browser SDK is enabled):
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-public-key

# -------------------------------------------------------------
# 3. OPTIONAL SERVER-ONLY SECRETS
# -------------------------------------------------------------
# Service role key for admin server routines (NEVER prefix with VITE_):
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-secret

# PostgreSQL connection pooler URI:
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# Google Gemini API key for AI health consultations:
GEMINI_API_KEY=your_gemini_api_key

# Node environment mode:
NODE_ENV=production
```

3. **Deploy & Verify**:
   - Trigger a new deployment in Vercel.
   - Verify that the server boots cleanly and `/api/health` returns status `ok`.

---

## Local Development

1. Create a `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```
2. Generate a secure `JWT_SECRET` with at least 32 characters in `.env`.
3. Install dependencies and start the dev server:
   ```bash
   npm install
   npm run dev
   ```
4. Access the application on `http://localhost:3000`.
