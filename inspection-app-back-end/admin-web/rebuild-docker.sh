#!/bin/bash
# Script to rebuild admin-web Docker container without cache
# This ensures all routes including monthly-report are included

echo "=== Rebuilding admin-web Docker container ==="
echo "This will rebuild without cache to ensure all routes are included"
echo ""

cd "$(dirname "$0")"

# Stop and remove existing container
echo "Stopping existing container..."
docker-compose stop admin-web 2>/dev/null || true
docker-compose rm -f admin-web 2>/dev/null || true

# Remove existing image
echo "Removing existing image..."
docker rmi inspection_app_admin-web 2>/dev/null || true

# Build without cache
echo "Building without cache..."
docker-compose build --no-cache admin-web

# Start the container
echo "Starting container..."
docker-compose up -d admin-web

echo ""
echo "=== Build complete ==="
echo "Check logs with: docker-compose logs -f admin-web"
echo "Access at: http://192.168.1.71:3002/monthly-report"

