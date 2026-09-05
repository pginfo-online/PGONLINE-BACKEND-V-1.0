# ==============================================================================
# Production Dockerfile for PGinfo.online Backend (AWS ECS / Fargate / App Runner)
# ==============================================================================
FROM node:20-alpine AS base

# Install tini for proper init process and signal forwarding (SIGTERM/SIGINT)
RUN apk add --no-cache tini curl

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=5001

# Copy dependency definitions
COPY package*.json ./

# Install production dependencies cleanly
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy application source code
COPY . .

# Create logs directory and assign permissions to non-root node user
RUN mkdir -p logs && chown -R node:node /app

# Use non-root node user for container security
USER node

# Expose API port
EXPOSE 5001

# Health check for AWS container orchestrators (ECS, Docker Swarm, App Runner)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:5001/health || exit 1

# Run with tini as PID 1 to ensure graceful shutdown signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start server
CMD ["node", "server.js"]
