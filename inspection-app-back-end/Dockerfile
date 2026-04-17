FROM node:18-alpine

# Install dependencies for puppeteer (Chromium and required libraries)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for nodemon)
RUN npm ci

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy templates folder (including repair_template.docx for repair reports)
COPY templates/ ./templates/

# Copy application code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /usr/src/app

# Note: /app/uploads will be mounted as volume from docker-compose.yml
# Run as nodejs user (permissions will be handled by volume mount)
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Start the application with nodemon for development or node for production
# Use dev:docker script for Docker environment with volume mount
CMD ["sh", "-c", "if [ \"$NODE_ENV\" = \"development\" ]; then npm run dev:docker; else npm start; fi"]
