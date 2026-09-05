# AWS Production Deployment Guide - PGinfo.online Backend

This guide provides a comprehensive, production-grade walkthrough for deploying the **PGinfo.online** Node.js backend to **Amazon Web Services (AWS)** using **EC2 + PM2 + Nginx + Let's Encrypt SSL**, or alternatively via **Docker / AWS ECS / App Runner**.

---

## 🏗️ Architecture Overview

```
                        [ Client / Mobile App / Web Frontend ]
                                          │
                                          ▼ (HTTPS :443)
                        [ AWS Route 53 (DNS) / CloudFront ]
                                          │
                                          ▼
                         [ AWS EC2 Instance / VPC ]
                      ┌─────────────────────────────────┐
                      │          Nginx Proxy            │
                      │   - SSL Termination (Certbot)   │
                      │   - Gzip Compression            │
                      │   - 50MB Upload Limit Buffer    │
                      │   - Client IP Header Forwarding │
                      └────────────────┬────────────────┘
                                       │ (HTTP :5001)
                                       ▼
                      ┌─────────────────────────────────┐
                      │      PM2 Cluster Manager        │
                      │  ┌─────────────┬─────────────┐  │
                      │  │ Worker #0   │ Worker #1   │  │
                      │  │ + Schedulers│ (API only)  │  │
                      │  └─────────────┴─────────────┘  │
                      │       PGinfo Express Backend    │
                      └────────────────┬────────────────┘
                                       │ (TLS :27017)
                                       ▼
                       [ MongoDB Atlas / DocumentDB ]
```

---

## 1. Prerequisites

1. **AWS Account** with permissions to launch EC2 instances and configure Security Groups.
2. **Domain / Subdomain** (e.g., `api.pginfo.online`) with DNS pointed to your EC2 Elastic IP or AWS ALB.
3. **MongoDB Atlas** cluster (with Network Access whitelisting the EC2 Elastic IP).
4. **Third-Party API Credentials** (Cloudinary, Groq/OpenAI, Razorpay, Resend, Ping4SMS, Meta WhatsApp, Google Maps).

---

## 2. AWS EC2 Provisioning

### Recommended Instance Specifications:
- **AMI**: Ubuntu 24.04 LTS or Ubuntu 22.04 LTS (x86_64 or arm64)
- **Instance Type**:
  - Minimum: `t3.small` (2 vCPU, 2GB RAM)
  - Recommended: `t3.medium` or `t4g.medium` (2 vCPU, 4GB RAM)
- **Storage**: 30 GB gp3 SSD (3000 IOPS, 125 MB/s)
- **Elastic IP**: Allocate and associate an Elastic IP (Static Public IP) to the instance.

### Security Group Inbound Rules:
| Type | Protocol | Port Range | Source | Description |
| :--- | :--- | :--- | :--- | :--- |
| **SSH** | TCP | `22` | `Your IP / Admin VPN` | Restrict SSH access to authorized IPs only |
| **HTTP** | TCP | `80` | `0.0.0.0/0` | Required for Certbot SSL challenge & HTTPS redirects |
| **HTTPS** | TCP | `443` | `0.0.0.0/0` | Secure public API traffic |

---

## 3. Server Setup & Dependencies

Connect to your EC2 instance via SSH:
```bash
ssh -i your-key.pem ubuntu@your-ec2-elastic-ip
```

### Step 3.1: Update System Packages
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw build-essential
```

### Step 3.2: Install Node.js 20 LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify versions
node -v # Should be v20.x.x
npm -v  # Should be v10.x.x
```

### Step 3.3: Install PM2 and PM2 Logrotate
```bash
sudo npm install -g pm2
sudo pm2 install pm2-logrotate

# Configure automatic log rotation to prevent disk exhaustion
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 10
pm2 set pm2-logrotate:compress true
```

### Step 3.4: Install Nginx & Certbot
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## 4. Deploying the Application

### Step 4.1: Clone the Codebase
```bash
sudo mkdir -p /var/www/pginfo
sudo chown -R ubuntu:ubuntu /var/www/pginfo
cd /var/www/pginfo

# Clone your repository
git clone <your-git-repository-url> .
cd backend
```

### Step 4.2: Configure Environment Variables
Create the production `.env` file from the updated `.env.example`:
```bash
cp .env.example .env
nano .env
```
Ensure the following critical production settings are configured:
```ini
NODE_ENV=production
PORT=5001
TRUST_PROXY=1
PM2_INSTANCES=max
ENABLE_SCHEDULERS=true
CLIENT_URL=https://pginfo.online,https://www.pginfo.online,https://admin.pginfo.online
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/pginfo?retryWrites=true&w=majority
USE_FALLBACK_DNS=false
JWT_SECRET=replace_with_a_secure_random_64_character_secret_key_in_production
# Fill in Cloudinary, Razorpay, Resend, SMS, and Maps keys...
```

### Step 4.3: Install Dependencies
```bash
npm ci --omit=dev
```

### Step 4.4: Start Backend with PM2
```bash
# Start via the hardened ecosystem configuration
pm2 start ecosystem.config.cjs --env production

# Check status
pm2 status
pm2 logs pginfo-backend --lines 30
```

### Step 4.5: Configure PM2 to Auto-Start on System Boot
```bash
# Generate and configure systemd startup script
pm2 startup systemd
# Run the command generated by the previous output (sudo env PATH=...)
pm2 save
```

---

## 5. Configuring Nginx & SSL

### Step 5.1: Create Nginx Site Configuration
```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/pginfo-backend
sudo nano /etc/nginx/sites-available/pginfo-backend
```
> Replace `api.pginfo.online` with your actual domain name.

### Step 5.2: Enable Site and Obtain SSL Certificate
```bash
# Link configuration to sites-enabled
sudo ln -s /etc/nginx/sites-available/pginfo-backend /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

# Issue Let's Encrypt SSL Certificate
sudo certbot --nginx -d api.pginfo.online
```

### Step 5.3: Test SSL Auto-Renewal
```bash
sudo certbot renew --dry-run
```

---

## 6. AWS Health Checks & Load Balancer (ALB) Setup

If you are using an AWS Application Load Balancer (ALB):
- **Health Check Path**: `/health` (or `/health/ready`)
- **Health Check Port**: `traffic-port` (or `5001` if direct target)
- **HTTP Success Code**: `200`
- **Healthy Threshold**: `2`
- **Unhealthy Threshold**: `3`
- **Timeout**: `5 seconds`
- **Interval**: `30 seconds`

---

## 7. Zero-Downtime Deployment Workflow

To deploy updates without dropping user connections:
```bash
cd /var/www/pginfo/backend

# 1. Pull latest code
git pull origin main

# 2. Update dependencies if package.json changed
npm ci --omit=dev

# 3. Perform zero-downtime cluster reload
npm run pm2:reload

# 4. Monitor logs to confirm successful start
pm2 logs pginfo-backend --lines 20
```

---

## 8. Alternative: Containerized Deployment (AWS ECS / Fargate)

A production-optimized `Dockerfile` and `.dockerignore` are included in the repository:

```bash
# Build the production container image
docker build -t pginfo-backend:latest .

# Run container locally or push to AWS ECR
docker run -d \
  --name pginfo-backend \
  -p 5001:5001 \
  --env-file .env \
  pginfo-backend:latest
```

In AWS ECS:
- Point Task Definition health check to `CMD-SHELL, curl -f http://localhost:5001/health || exit 1`.
- Provide environment variables securely via AWS Secrets Manager or AWS Systems Manager Parameter Store.
- Set desired task count to 2+ across multiple Availability Zones for High Availability.
