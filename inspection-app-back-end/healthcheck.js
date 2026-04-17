/**
 * Health check script for Docker container
 * Checks if the backend server is responding
 */

const http = require('http');

const options = {
  // Use IPv4 loopback to avoid "::1" issues in some containers
  host: '127.0.0.1',
  port: process.env.PORT || 3000,
  path: '/health',
  method: 'GET',
  timeout: 2000,
};

const request = http.request(options, (res) => {
  if (res.statusCode === 200) {
    process.exit(0); // Healthy
  } else {
    process.exit(1); // Unhealthy
  }
});

request.on('error', (err) => {
  console.error('Health check failed:', err.message);
  process.exit(1); // Unhealthy
});

request.on('timeout', () => {
  request.destroy();
  console.error('Health check timeout');
  process.exit(1); // Unhealthy
});

request.end();
