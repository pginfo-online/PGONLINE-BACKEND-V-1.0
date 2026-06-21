# Render Deployment Guide - PGinfo.online Backend

This guide provides a step-by-step walkthrough to deploy the Node.js backend of **PGinfo.online** to [Render](https://render.com).

---

## 📋 Prerequisites

Before deploying, ensure you have the following ready:
1. **GitHub Account**: A GitHub repository containing your project codebase.
2. **MongoDB Atlas Account**: A running MongoDB cluster.
3. **Cloudinary Account**: For handling media uploads.
4. **Groq Account & API Key**: For AI-powered chat functions.

---

## 🚀 Step-by-Step Deployment on Render

### Step 1: Push your Code to GitHub
Ensure all your backend files (including the updated `server.js`, `db.js`, `package.json`, and `.gitignore`) are committed and pushed to a remote GitHub repository.
> [!WARNING]
> Do NOT upload your `.env` file to GitHub. The `.gitignore` file we added will prevent this. You will configure these variables directly in the Render dashboard.

### Step 2: Create a New Web Service on Render
1. Log in to the [Render Dashboard](https://dashboard.render.com).
2. Click the **New +** button in the top right and select **Web Service**.
3. Select **Build and deploy from a Git repository** and connect your GitHub account.
4. Search for your repository and click **Connect**.

### Step 3: Configure the Web Service Settings
Fill in the deployment details in the Render form:

| Field | Configuration Value | Notes |
| :--- | :--- | :--- |
| **Name** | `pginfo-backend` | Or any unique identifier |
| **Region** | Choose region closest to users | E.g., `Singapore` or `Oregon` |
| **Branch** | `main` | Or your default production branch |
| **Root Directory** | `backend` | **CRITICAL**: Set to `backend` since it is in a subdirectory |
| **Runtime** | `Node` | Selected automatically |
| **Build Command** | `npm install` | Render runs this to install dependencies |
| **Start Command** | `npm start` | Runs `node server.js` |
| **Instance Type** | `Free` (or custom paid tier) | Free tier spins down after inactivity |

---

### Step 4: Configure Environment Variables
Scroll down to the **Environment Variables** section on the Render Web Service creation page (or navigate to **Environment** in the sidebar after creation). Add the following key-value pairs:

| Variable Name | Example Value / Description | Notes |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production security and disables stack traces in errors. |
| `PORT` | `10000` | Render sets this automatically, but you can define it. |
| `MONGODB_URI` | `mongodb+srv://<username>:<password>@cluster.mongodb.net/database_name` | **Required**: Connection string for your production database. |
| `JWT_SECRET` | `generate-a-strong-random-key-here` | **Required**: Cryptographic secret for signing auth tokens. |
| `JWT_EXPIRES_IN` | `7d` | Duration for token validity. |
| `CLOUDINARY_CLOUD_NAME` | `your_cloudinary_name` | **Required** for image storage. |
| `CLOUDINARY_API_KEY` | `your_cloudinary_api_key` | **Required** for image storage. |
| `CLOUDINARY_API_SECRET` | `your_cloudinary_api_secret` | **Required** for image storage. |
| `GROQ_API_KEY` | `gsk_your_groq_api_key_here` | **Required** for AI chat capability. |
| `CLIENT_URL` | `https://your-frontend.vercel.app` | **Required**: Production domain of your frontend. You can list multiple origins separated by commas (e.g. `https://your-frontend.vercel.app,http://localhost:5173`). |

---

### Step 5: Deploy and Verify
1. Click **Create Web Service** at the bottom of the page.
2. Render will trigger a build: installing dependencies and starting the server.
3. Watch the logs. You should see:
   ```text
   ==> Express App running on port 10000
   ==> MongoDB connected: cluster-xxx.mongodb.net
   ```
4. Copy the URL provided by Render (e.g., `https://pginfo-backend.onrender.com`).
5. Open your browser and navigate to the health check endpoint:
   `https://pginfo-backend.onrender.com/health`
6. You should see a JSON response confirming successful execution:
   ```json
   {
     "success": true,
     "message": "PGinfo.online API is running",
     "version": "1.0.0",
     "timestamp": "2026-06-21T09:00:00.000Z"
   }
   ```

---

## 🔒 Security & Scaling Notes

- **Database Access Rules**: In MongoDB Atlas, you must allow connection requests. Under **Network Access**, add `0.0.0.0/0` (allow access from anywhere) because Render's outbound IP addresses are dynamic. Alternatively, you can use a static outbound IP proxy service if strict IP security is needed.
- **CORS Protection**: Double check that `CLIENT_URL` is configured correctly. Requests from unauthorized origins will be blocked with a CORS error.
- **Spin-up Delay (Free Tier)**: If you use the Free instance tier on Render, the container goes to sleep after 15 minutes of inactivity. The next request triggers a cold-start, taking 50-90 seconds. To avoid this, consider upgrading to the **Starter** tier ($7/month) or using a ping service (like UptimeRobot) to keep it awake.
