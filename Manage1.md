# PG Management Production Guide & Operations Runbook (`Manage.md`)

This guide provides end-to-end production setup instructions for the **PG / Hostel Management Backend**, covering:
1. **Redis & Razorpay Setup Guide**
2. **Meta WhatsApp Cloud API Templates Specification**
3. **Production Go-Live Checklist & Deployment Runbook**

---

# Table of Contents
- [1. Redis Setup Guide](#1-redis-setup-guide)
  - [1.1 Why Redis is Required](#11-why-redis-is-required)
  - [1.2 Setup Options (Docker, Cloud, Self-Hosted)](#12-setup-options-docker-cloud-self-hosted)
  - [1.3 Environment Variables](#13-environment-variables)
  - [1.4 BullMQ Queues in the Backend](#14-bullmq-queues-in-the-backend)
  - [1.5 Verifying Redis Connection](#15-verifying-redis-connection)
- [2. Razorpay Payment Gateway Setup Guide](#2-razorpay-payment-gateway-setup-guide)
  - [2.1 Account Activation (Test vs Live)](#21-account-activation-test-vs-live)
  - [2.2 Generating API Keys](#22-generating-api-keys)
  - [2.3 Webhook Configuration](#23-webhook-configuration)
  - [2.4 Webhook Signature Verification Details](#24-webhook-signature-verification-details)
  - [2.5 Payment Workflows](#25-payment-workflows)
- [3. WhatsApp Business Cloud API Templates](#3-whatsapp-business-cloud-api-templates)
  - [3.1 Meta Developer App & Token Setup](#31-meta-developer-app--token-setup)
  - [3.2 Template Catalog (Exact Names, Categories & Bodies)](#32-template-catalog-exact-names-categories--bodies)
  - [3.3 Template Approval Best Practices](#33-template-approval-best-practices)
- [4. Complete Backend Production Go-Live Checklist](#4-complete-backend-production-go-live-checklist)
  - [4.1 MongoDB Atlas Production Configuration](#41-mongodb-atlas-production-configuration)
  - [4.2 Full Environment Variables (`.env`) Checklist](#42-full-environment-variables-env-checklist)
  - [4.3 PM2 Clustering & Process Management](#43-pm2-clustering--process-management)
  - [4.4 Nginx Reverse Proxy & Let's Encrypt SSL](#44-nginx-reverse-proxy--lets-encrypt-ssl)
  - [4.5 Automated Schedulers & Cron Jobs](#45-automated-schedulers--cron-jobs)
  - [4.6 Health Checks, Logging & Monitoring](#46-health-checks-logging--monitoring)
  - [4.7 Step-by-Step Go-Live Deployment Commands](#47-step-by-step-go-live-deployment-commands)

---

# 1. Redis Setup Guide

### 1.1 Why Redis is Required
The backend uses **Redis** via `ioredis` and **BullMQ** for:
* **Asynchronous Background Processing:** Offloading PDF receipt generation, bulk rent record generation, and automated reminder broadcasts.
* **Job Retry & Exponential Backoff:** Ensuring failed WhatsApp/SMS delivery or transient network timeouts retry safely without duplicating charges.
* **Rate-Limiting & Caching:** Fast in-memory counters and temporary session tokens.

### 1.2 Setup Options

#### Option A: Managed Cloud Redis (Recommended for Production)
* **Upstash Redis (Serverless):**
  1. Sign up at [upstash.com](https://upstash.com).
  2. Create a Database with TLS enabled in your target region (e.g. `ap-south-1` Mumbai).
  3. Copy the `REDIS_URL`:
     ```env
     REDIS_URL=rediss://default:your_token@ap-south-1.upstash.io:6379
     ```
* **AWS ElastiCache (Cluster Mode / Single Node):**
  1. Create a Redis replication group in the same VPC as your EC2 instances.
  2. Use the Primary Endpoint with security group permitting port `6379` from your backend instances.
* **Redis Cloud (redis.com):**
  1. Create a free/paid subscription and copy the endpoint & password.

#### Option B: Docker (Fastest for Local & Staging)
```bash
docker run -d \
  --name pginfo-redis \
  -p 6379:6379 \
  --restart unless-stopped \
  redis:7-alpine redis-server --requirepass "your_strong_redis_password"
```

#### Option C: Ubuntu / Linux Server (Self-Hosted)
```bash
sudo apt update && sudo apt install -y redis-server
sudo sed -i 's/^supervised no/supervised systemd/' /etc/redis/redis.conf
sudo sed -i 's/^# requirepass foobared/requirepass your_strong_redis_password/' /etc/redis/redis.conf
sudo systemctl restart redis.service
sudo systemctl enable redis.service
```

### 1.3 Environment Variables
Add to your `backend/.env`:
```env
# Full connection string:
REDIS_URL=redis://:your_strong_redis_password@127.0.0.1:6379

# OR separate parameters:
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=your_strong_redis_password
REDIS_DB=0
REDIS_KEY_PREFIX=pgm:
```

### 1.4 BullMQ Queues in the Backend
Defined in `backend/src/config/queue.js`:
| Queue Name | Purpose | Worker Concurrency |
| :--- | :--- | :--- |
| `pgm:rent-generation` | Bulk monthly invoice creation | 1 (atomic) |
| `pgm:rent-reminders` | Due date & overdue reminders (WhatsApp/Email) | 5 concurrent |
| `pgm:receipt-generation` | Headless PDF rent receipt generation & Cloudinary upload | 3 concurrent |
| `pgm:notifications` | Push notifications via Expo SDK | 10 concurrent |
| `pgm:payment-links` | Automated Razorpay link creation | 5 concurrent |

> **Note:** The backend automatically configures `maxRetriesPerRequest: null` in `backend/src/config/redis.js` as required by BullMQ.

### 1.5 Verifying Redis Connection
Test connectivity directly from the server:
```bash
# Using redis-cli:
redis-cli -h 127.0.0.1 -p 6379 -a "your_strong_redis_password" ping
# Output: PONG

# Check queue keys created:
redis-cli -a "your_strong_redis_password" keys "pgm:*"
```

---

# 2. Razorpay Payment Gateway Setup Guide

### 2.1 Account Activation (Test vs Live)
1. Sign up at [dashboard.razorpay.com](https://dashboard.razorpay.com).
2. Complete **Business KYC** (Company PAN, GSTIN if applicable, Bank Account for automated settlements).
3. Test all flows using **Test Mode** first (`rzp_test_...`), then switch to **Live Mode** (`rzp_live_...`).

### 2.2 Generating API Keys
1. Go to **Dashboard → Settings → API Keys**.
2. Click **Generate Key**.
3. Save both keys securely:
   * **Key ID:** `RAZORPAY_KEY_ID` (Safe to share with mobile/web clients)
   * **Key Secret:** `RAZORPAY_KEY_SECRET` (Must remain strictly secret on server)

### 2.3 Webhook Configuration
Webhooks guarantee that even if a resident closes the browser/app immediately after UPI/card payment, the backend still captures the payment and issues the receipt.

1. In Razorpay Dashboard, navigate to **Settings → Webhooks**.
2. Click **Add New Webhook**:
   * **Webhook URL:** `https://api.yourdomain.com/api/v1/manage/payments/webhook`
   * **Secret:** Enter a strong random secret (e.g. `openssl rand -hex 24`).
   * **Active Events to Select:**
     * `payment.captured` *(CRITICAL: Triggered on successful debit)*
     * `payment.failed` *(Triggered when payment fails)*
     * `order.paid` *(Triggered when order amount is satisfied)*
     * `payment_link.paid` *(Triggered when resident pays via WhatsApp link)*
3. Add the secret to your `backend/.env`:
   ```env
   RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
   RAZORPAY_WEBHOOK_SECRET=your_generated_webhook_secret_here
   ```

### 2.4 Webhook Signature Verification Details
* The backend verifies every webhook payload using HMAC-SHA256 signature verification in `backend/src/services/manage/razorpay.service.js`.
* `backend/server.js` includes raw-body capture specifically for `/api/v1/manage/payments/webhook`:
  ```javascript
  app.use('/api/v1/manage/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), ...);
  ```
* Webhook processing is **strictly idempotent**: duplicate webhook delivery attempts will not credit rent twice or send multiple receipts.

### 2.5 Payment Workflows Supported
1. **Automated Payment Link via WhatsApp:**
   Owner taps *"Send Payment Link"* in the app → Backend calls Razorpay Payment Link API → Resident receives link on WhatsApp with pre-filled amount and room details → Resident pays via Google Pay/PhonePe/Card → Webhook marks `RentRecord` as `paid` → Auto-generates receipt.
2. **In-App Checkout (Web/Mobile):**
   Client initiates order (`POST /manage/payments/orders`) → Receives `orderId` → Opens Razorpay SDK → On success, client sends signature to `POST /manage/payments/verify`.
3. **Manual Payment Recording (Cash/Direct UPI):**
   Owner collects cash or receives offline UPI → Records via `POST /manage/rent/:id/mark-paid` → System generates official serial numbered PDF receipt and delivers confirmation via WhatsApp.

---

# 3. WhatsApp Business Cloud API Templates

The PG Management system integrates directly with **Meta WhatsApp Cloud API** via `backend/src/services/notification/whatsapp.service.js`.

### 3.1 Meta Developer App & Token Setup
1. Go to [developers.facebook.com](https://developers.facebook.com) and create a **Business App**.
2. Add the **WhatsApp** product.
3. Link your **WhatsApp Business Account (WABA)** and verified phone number.
4. In **Business Settings → System Users**:
   * Create an Admin System User.
   * Assign permissions: `whatsapp_business_messaging`, `whatsapp_business_management`.
   * Generate a **Permanent Access Token** (never expires).
5. Add to your `backend/.env`:
   ```env
   WHATSAPP_ACCESS_TOKEN=EAAG...your_permanent_system_user_token...
   WHATSAPP_PHONE_NUMBER_ID=109xxxxxxxxxxxx
   WHATSAPP_BUSINESS_ID=102xxxxxxxxxxxx
   WHATSAPP_API_VERSION=v21.0
   ```

---

### 3.2 Template Catalog (Exact Names, Categories & Bodies)

Submit these templates in **Meta Business Manager → WhatsApp Manager → Message Templates**. All templates must be approved before production broadcast.

---

#### Template 1: `rent_reminder`
* **Category:** `UTILITY`
* **Language:** `en` (English)
* **Header (Optional):** Text: `Rent Payment Reminder`
* **Body Text:**
  ```text
  Hello {{1}}, this is a friendly reminder that your rent of ₹{{4}} for Room {{3}} at {{2}} is due on {{5}}. Please make the payment on or before the due date. Thank you, {{6}}.
  ```
* **Sample Values:**
  * `{{1}}` = `Rahul Sharma`
  * `{{2}}` = `Sri Sai Balaji Luxury PG`
  * `{{3}}` = `204`
  * `{{4}}` = `8500`
  * `{{5}}` = `05 Oct 2026`
  * `{{6}}` = `Sri Sai Balaji Management`
* **Buttons (Optional):**
  * Type: `Quick Reply` or `URL` button to payment link.

---

#### Template 2: `rent_overdue`
* **Category:** `UTILITY`
* **Language:** `en`
* **Header (Optional):** Text: `Overdue Rent Notice`
* **Body Text:**
  ```text
  Hello {{1}}, your rent payment of ₹{{4}} for Room {{3}} at {{2}} was due on {{5}} and is now overdue by {{6}} days. Please clear the pending dues immediately to avoid late fees. Regards, {{7}}.
  ```
* **Sample Values:**
  * `{{1}}` = `Anand Kumar`
  * `{{2}}` = `Green View Coliving`
  * `{{3}}` = `102`
  * `{{4}}` = `9000`
  * `{{5}}` = `05 Oct 2026`
  * `{{6}}` = `3`
  * `{{7}}` = `Green View Management`

---

#### Template 3: `payment_confirmation`
* **Category:** `UTILITY`
* **Language:** `en`
* **Header (Optional):** Text: `Rent Payment Received`
* **Body Text:**
  ```text
  Hello {{1}}, we have received your payment of ₹{{4}} for Room {{3}} at {{2}} via {{5}} on {{6}}. Receipt No: {{7}}. Thank you for your timely payment! - {{8}}
  ```
* **Sample Values:**
  * `{{1}}` = `Vikram Reddy`
  * `{{2}}` = `Venkateshwara PG`
  * `{{3}}` = `301`
  * `{{4}}` = `7500`
  * `{{5}}` = `UPI`
  * `{{6}}` = `25 Sep 2026`
  * `{{7}}` = `REC-2026-0089`
  * `{{8}}` = `Venkateshwara PG Office`

---

#### Template 4: `welcome_tenant`
* **Category:** `UTILITY`
* **Language:** `en`
* **Header (Optional):** Text: `Welcome to Your New Home`
* **Body Text:**
  ```text
  Welcome to {{2}}, {{1}}! Your check-in is confirmed for Room {{3}}, Bed {{4}} starting from {{5}}. Your monthly rent is ₹{{6}}. We hope you have a pleasant stay! - {{7}}
  ```
* **Sample Values:**
  * `{{1}}` = `Siddharth Rao`
  * `{{2}}` = `Sri Balaji PG`
  * `{{3}}` = `104`
  * `{{4}}` = `B2`
  * `{{5}}` = `01 Oct 2026`
  * `{{6}}` = `8000`
  * `{{7}}` = `Sri Balaji Management`

---

#### Template 5: `lease_expiry_reminder`
* **Category:** `UTILITY`
* **Language:** `en`
* **Body Text:**
  ```text
  Hello {{1}}, this is a notice that your stay agreement at {{2}} is ending on {{3}}. As per policy, your notice period is {{4}} days. Please contact management if you wish to extend or plan your move-out. - {{5}}
  ```
* **Sample Values:**
  * `{{1}}` = `Deepak Jain`
  * `{{2}}` = `Comfort Coliving`
  * `{{3}}` = `31 Oct 2026`
  * `{{4}}` = `30`
  * `{{5}}` = `Comfort Coliving Management`

---

#### Template 6: `vacancy_alert`
* **Category:** `UTILITY`
* **Language:** `en`
* **Body Text:**
  ```text
  Alert for {{1}}: Tenant {{4}} is scheduled to vacate Room {{2}}, Bed {{3}} on {{5}}. Total vacant beds will be {{6}}. - PGInfo Management
  ```
* **Sample Values:**
  * `{{1}}` = `Royal Palms PG`
  * `{{2}}` = `202`
  * `{{3}}` = `B1`
  * `{{4}}` = `Arjun Patel`
  * `{{5}}` = `15 Oct 2026`
  * `{{6}}` = `4`

---

#### Template 7: `rent_receipt`
* **Category:** `UTILITY`
* **Language:** `en`
* **Header:** `Document` (PDF attachment)
* **Body Text:**
  ```text
  Dear {{1}}, please find attached the official rent receipt for your payment of ₹{{2}} for {{3}} at {{4}}. Thank you! - {{5}}
  ```
* **Sample Values:**
  * `{{1}}` = `Priya Sundaram`
  * `{{2}}` = `8500`
  * `{{3}}` = `October 2026`
  * `{{4}}` = `Lakshmi Nilaya PG`
  * `{{5}}` = `Lakshmi Nilaya Management`

---

#### Template 8: `pginfo_login_otp` (User Authentication)
* **Category:** `AUTHENTICATION`
* **Language:** `en_US`
* **Body:** Meta standard authentication OTP template with 1-tap copy code button.

---

### 3.3 Template Approval Best Practices
1. **Always Choose `UTILITY` Category:** Meta strictly rejects transactional reminders submitted under `MARKETING`.
2. **Do Not Include Marketing Buzzwords:** Avoid words like *"offer"*, *"discount"*, *"hurry"*.
3. **Always Provide Realistic Sample Values:** In Meta's template submission screen, fill out all sample values (`{{1}}`, `{{2}}`, etc.) accurately. Meta reviewers automatically reject templates with generic placeholders like `"test"`, `"asdf"`, or blank samples.
4. **Phone Number Verification:** Ensure your WhatsApp Business phone number is registered, has a display name approved, and two-tier PIN set up.

---

# 4. Complete Backend Production Go-Live Checklist

### 4.1 MongoDB Atlas Production Configuration
* **Replica Set:** Always use a 3-node replica set (`M10+` for production workloads).
* **Connection Pool:**
  ```env
  MONGO_MAX_POOL_SIZE=25
  MONGO_MIN_POOL_SIZE=5
  MONGO_CONNECT_MAX_RETRIES=5
  USE_FALLBACK_DNS=true
  ```
  *(Note: `USE_FALLBACK_DNS=true` is enabled in `backend/src/config/db.js` to ensure Linux servers and Docker containers resolve Atlas SRV lookups reliably without DNS timeouts).*
* **Database Indexes:**
  Run the automated indexing script to ensure sub-millisecond query performance:
  ```bash
  node src/scripts/ensure-indexes.js
  ```
  Key indexes:
  - `RentRecord`: `{ pg: 1, billingMonth: 1, billingYear: 1 }`, `{ status: 1, dueDate: 1 }`
  - `Payment`: `{ razorpayOrderId: 1 }`, `{ pg: 1, status: 1 }`
  - `Tenant`: `{ pg: 1, status: 1 }`, `{ phone: 1 }`

---

### 4.2 Full Environment Variables (`.env`) Checklist
Ensure every variable is populated before starting the server:

```env
# ── SERVER ──
PORT=5001
NODE_ENV=production
TRUST_PROXY=1
RATE_LIMIT_MAX=1000

# ── DATABASE ──
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xxxx.mongodb.net/pginfo_prod?retryWrites=true&w=majority
USE_FALLBACK_DNS=true

# ── AUTHENTICATION ──
JWT_SECRET=use_openssl_rand_base64_64_to_generate_a_secure_token
JWT_EXPIRES_IN=7d

# ── CORS ──
CLIENT_URL=https://pginfo.online,https://www.pginfo.online,https://admin.pginfo.online

# ── REDIS & QUEUES ──
REDIS_URL=redis://:your_password@127.0.0.1:6379
REDIS_KEY_PREFIX=pgm:

# ── PAYMENT (RAZORPAY) ──
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# ── WHATSAPP (META CLOUD API) ──
WHATSAPP_ACCESS_TOKEN=your_permanent_system_user_token
WHATSAPP_PHONE_NUMBER_ID=your_meta_phone_number_id
WHATSAPP_BUSINESS_ID=your_meta_business_waba_id
WHATSAPP_API_VERSION=v21.0

# ── MEDIA STORAGE (CLOUDINARY) ──
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# ── TRANSACTIONAL EMAIL (RESEND) ──
RESEND_API_KEY=re_your_api_key
RESEND_FROM_EMAIL=notifications@pginfo.online

# ── BACKGROUND SCHEDULERS ──
ENABLE_SCHEDULERS=true
PM2_INSTANCES=max
```

---

### 4.3 PM2 Clustering & Process Management
The application includes `ecosystem.config.cjs` configured for production cluster mode:
* Schedulers automatically initialize **only on instance 0** to avoid duplicate reminders or duplicate invoices.
* Workers auto-restart on memory leaks (`max_memory_restart: '1G'`).

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the cluster
pm2 start ecosystem.config.cjs --env production

# Save process list for server reboot
pm2 save
pm2 startup
```

Useful PM2 operational commands:
```bash
pm2 status                  # Check worker statuses and CPU/memory
pm2 logs backend --lines 50 # Live combined stream of all workers
pm2 reload ecosystem.config.cjs --update-env # Zero-downtime reload
```

---

### 4.4 Nginx Reverse Proxy & Let's Encrypt SSL

Create `/etc/nginx/sites-available/pginfo-api`:
```nginx
server {
    server_name api.pginfo.online;

    client_max_body_size 25M;

    # Gzip Compression
    gzip on;
    gzip_types text/plain application/json text/css application/javascript;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }

    # Dedicated Webhook Route for Razorpay
    location /api/v1/manage/payments/webhook {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Razorpay-Signature $http_x_razorpay_signature;
    }
}
```

Enable site & provision free SSL:
```bash
sudo ln -s /etc/nginx/sites-available/pginfo-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.pginfo.online --non-interactive --agree-tos -m admin@pginfo.online
```

---

### 4.5 Automated Schedulers & Cron Jobs
When `ENABLE_SCHEDULERS=true`, the backend automatically executes:
1. **Rent Due Scanner (Daily at 09:00 AM IST):** Scans active rent records due in `remindDaysBefore` days and queues WhatsApp messages via template `rent_reminder`.
2. **Overdue Rent Scanner (Daily at 10:00 AM IST):** Scans unpaid records past due date, applies `lateFeePerDay`, changes status to `overdue`, and dispatches `rent_overdue` WhatsApp messages.
3. **Monthly Rent Generation (1st of every month at 00:05 AM IST):** Auto-creates rent records for all active tenants according to PG billing settings.
4. **Temporary Export / Cleanup Jobs (Daily at 02:00 AM IST):** Cleans up expired temporary export files.

---

### 4.6 Health Checks, Logging & Monitoring

* **Health Endpoints:**
  * Liveness check: `GET https://api.pginfo.online/health/live` (Returns `200 OK`)
  * Readiness check: `GET https://api.pginfo.online/health/ready` (Validates MongoDB & Redis connectivity)
* **Winston Logging:**
  Logs are written to `./logs/` with automatic daily rotation:
  * `logs/error.log` (Only errors and fatal exceptions)
  * `logs/combined.log` (All operations)
* **Log Rotation Setup (`logrotate`):**
  Add `/etc/logrotate.d/pginfo-backend`:
  ```text
  /path/to/backend/logs/*.log {
      daily
      missingok
      rotate 14
      compress
      delaycompress
      notifempty
      create 0640 node node
  }
  ```

---

### 4.7 Step-by-Step Go-Live Deployment Commands

Run these commands on your production server:

```bash
# 1. Clone repository
git clone <YOUR_GIT_REPO_URL> /var/www/pginfo
cd /var/www/pginfo/backend

# 2. Install production dependencies
npm ci --omit=dev

# 3. Configure production environment
cp .env.example .env
nano .env   # Fill in actual credentials (MongoDB, Redis, Razorpay, WhatsApp, Cloudinary)

# 4. Verify Database connectivity & Indexes
node -e "require('./src/config/db')().then(() => { console.log('✅ DB Connected'); process.exit(0); });"

# 5. Start Redis Service
sudo systemctl start redis && sudo systemctl enable redis

# 6. Launch Backend Cluster with PM2
pm2 start ecosystem.config.cjs --env production
pm2 save

# 7. Configure Nginx & SSL
sudo nginx -t && sudo systemctl reload nginx

# 8. Test Live Health
curl -I https://api.pginfo.online/health/ready
# Expected: HTTP/2 200 OK
```

---
*End of `Manage.md` — PG Management Production Runbook*
