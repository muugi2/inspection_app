const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    if (!token) {
      console.log(`[auth] ❌ No token provided for ${req.method} ${req.originalUrl}`);
      return res.status(401).json({
        error: 'Access denied',
        message: 'No token provided',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Add user info to request
    req.user = decoded;

    console.log(`[auth] ✅ Authenticated user for ${req.method} ${req.originalUrl}`);
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      console.log(`[auth] ❌ Token expired for ${req.method} ${req.originalUrl}`);
      return res.status(401).json({
        error: 'Token expired',
        message: 'Please login again',
      });
    }

    console.log(`[auth] ❌ Invalid token for ${req.method} ${req.originalUrl}:`, error.message);
    return res.status(401).json({
      error: 'Invalid token',
      message: 'Authentication failed',
    });
  }
};

// Optional middleware - allows both authenticated and unauthenticated requests
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

module.exports = {
  authMiddleware,
  optionalAuth,
};









