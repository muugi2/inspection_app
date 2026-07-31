const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
// Priority: 1. Environment variables (Docker/Production), 2. config.env file (Development)
// Docker container дотор environment variables байгаа бол config.env унших шаардлагагүй
console.log('🔍 Loading environment variables...');
console.log('   DB_HOST:', process.env.DB_HOST || 'not set');
console.log('   PORT:', process.env.PORT || 'not set');

if (!process.env.DB_HOST && !process.env.PORT) {
  // Development mode - host дээр ажиллах үед config.env унших
  console.log('   📄 Loading config.env file...');
  dotenv.config({ path: path.join(__dirname, 'config.env') });
  console.log('   ✅ config.env loaded');
  console.log('   PORT after loading:', process.env.PORT);
} else {
  console.log('   ℹ️  Using environment variables (Docker/Production mode)');
}

// Set DATABASE_URL for Prisma
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `mysql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
}

const app = express();
// Default port: 4555 (to match Flutter app and admin-web expectations)
// Docker uses 3000 internally, but maps to 4555 externally
const PORT = process.env.PORT || 4555;

// Middleware
app.use(helmet()); // Security headers
// CORS configuration - allow all origins for development
app.use(cors({
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(morgan('combined')); // Logging
app.use(express.json({ limit: '50mb' })); // Parse JSON bodies (increased limit for image uploads)
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Parse URL-encoded bodies (increased limit for image uploads)

// Serve uploaded inspection images from FTP storage via HTTP
const FTP_STORAGE_PATH =
  process.env.FTP_STORAGE_PATH || path.resolve('C:/ftp_data');
app.use(
  '/uploads',
  express.static(path.resolve(FTP_STORAGE_PATH), {
    setHeaders: res => {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  })
);

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Inspection App API - Hot Reload Active! 🔥',
    version: '1.0.0',
    status: 'running',
    hotReload: true,
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
  });
});

// API routes
// IMPORTANT: More specific routes should be registered before more general ones
console.log('📋 Registering API routes...');
app.use('/api/auth', require('./routes/auth'));
app.use('/api/upload', require('./routes/upload')); // Image upload endpoint
app.use('/api/inspections', require('./routes/inspections'));
app.use('/api/inspection-answers', require('./routes/answers'));
app.use('/api/organizations', require('./routes/organizations'));
app.use('/api/sites', require('./routes/sites'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/device-models', require('./routes/device-models'));
app.use('/api/devices', require('./routes/devices'));
app.use('/api/users', require('./routes/users'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/documents', require('./routes/documents'));
console.log('📋 Registering installation-assignments route...');
try {
  const installationAssignmentsRoute = require('./routes/installation-assignments');
  console.log('✅ Installation assignments route module loaded successfully');
  app.use('/api/installation-assignments', installationAssignmentsRoute);
  console.log('✅ Installation assignments route registered successfully at /api/installation-assignments');
} catch (error) {
  console.error('❌ Failed to register installation-assignments route:', error);
  console.error('   Error message:', error.message);
  console.error('   Error stack:', error.stack);
  throw error; // Re-throw to prevent server from starting with broken route
}

console.log('📋 Registering installation-acts route...');
try {
  const installationActsRoute = require('./routes/installation-acts');
  console.log('✅ Installation acts route module loaded successfully');
  app.use('/api/installation-acts', installationActsRoute);
  console.log('✅ Installation acts route registered successfully at /api/installation-acts');
} catch (error) {
  console.error('❌ Failed to register installation-acts route:', error);
  console.error('   Error message:', error.message);
  console.error('   Error stack:', error.stack);
  throw error; // Re-throw to prevent server from starting with broken route
}
try {
  app.use('/api/repairs', require('./routes/repairs'));
  console.log('✅ Repairs route registered successfully');
} catch (error) {
  console.error('❌ Failed to register repairs route:', error);
  console.error('   Error message:', error.message);
  console.error('   Error stack:', error.stack);
}
console.log('📋 Registering verifications route...');
try {
  const verificationsRoute = require('./routes/verifications');
  console.log('✅ Verifications route module loaded successfully');
  app.use('/api/verifications', verificationsRoute);
  console.log('✅ Verifications route registered successfully at /api/verifications');
} catch (error) {
  console.error('❌ Failed to register verifications route:', error);
  console.error('   Error message:', error.message);
  console.error('   Error stack:', error.stack);
  throw error; // Re-throw to prevent server from starting with broken route
}

// 404 handler
app.use('*', (req, res) => {
  console.log(`[server] ❌ 404 - Route not found: ${req.method} ${req.originalUrl}`);
  console.log(`[server] Request path: ${req.path}, Base URL: ${req.baseUrl}`);
  console.log(`[server] Registered routes:`);
  console.log(`[server]   - /api/auth`);
  console.log(`[server]   - /api/upload`);
  console.log(`[server]   - /api/inspections`);
  console.log(`[server]   - /api/inspection-answers`);
  console.log(`[server]   - /api/organizations`);
  console.log(`[server]   - /api/sites`);
  console.log(`[server]   - /api/contracts`);
  console.log(`[server]   - /api/device-models`);
  console.log(`[server]   - /api/devices`);
  console.log(`[server]   - /api/users`);
  console.log(`[server]   - /api/templates`);
  console.log(`[server]   - /api/documents`);
  console.log(`[server]   - /api/installation-assignments`);
  console.log(`[server]   - /api/repairs`);
  res.status(404).json({
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    path: req.path,
    baseUrl: req.baseUrl,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message:
      process.env.NODE_ENV === 'development'
        ? err.message
        : 'Internal server error',
  });
});

// Start server
// Listen on all network interfaces (0.0.0.0) to allow network access
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📱 API available at http://localhost:${PORT}`);
  console.log(`📱 API available at http://192.168.1.54:${PORT}`);
  console.log(`🏥 Health check at http://localhost:${PORT}/health`);
  console.log(`🌐 Network access: http://${require('os').networkInterfaces()['Ethernet']?.[0]?.address || '0.0.0.0'}:${PORT}`);
});

module.exports = app;
