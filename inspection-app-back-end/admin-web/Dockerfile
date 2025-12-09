# Multi-stage build for Next.js production

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set environment variables for build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build the application
RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public

# Copy standalone output if it exists, otherwise copy full .next folder
# Standalone output structure: .next/standalone/admin-web/...
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# If standalone has subfolder structure, ensure server.js is accessible
# Next.js standalone creates: .next/standalone/admin-web/server.js
# We need to handle both structures

# Copy package.json for standalone mode (if needed)
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Set correct permissions
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3001

ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

# Use standalone server.js if it exists, otherwise use next start
# Try admin-web/server.js first (if standalone has subfolder), then server.js
CMD ["sh", "-c", "if [ -f admin-web/server.js ]; then node admin-web/server.js; else node server.js; fi"]

