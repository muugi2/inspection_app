const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Helper function to generate JWT
const generateToken = user => {
  return jwt.sign(
    {
      id: user.id.toString(),
      email: user.email,
      orgId: user.orgId.toString(),
      fullName: user.fullName,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName, phone, orgId } = req.body;

    // Validate required fields
    if (!email || !password || !fullName || !orgId) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Email, password, fullName, and orgId are required',
      });
    }

    // Check if user already exists
    const existingUser = await prisma.User.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'User already exists',
        message: 'An account with this email already exists',
      });
    }

    // Validate organization exists
    const organization = await prisma.Organization.findUnique({
      where: { id: BigInt(orgId) },
    });

    if (!organization) {
      return res.status(404).json({
        error: 'Organization not found',
        message: 'The specified organization does not exist',
      });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = await prisma.User.create({
      data: {
        email,
        passwordHash,
        fullName,
        phone,
        orgId: BigInt(orgId),
      },
      include: {
        organization: true,
        role: true,
      },
    });

    // Generate token
    const token = generateToken(user);

    // Return user data without password
    res.status(201).json({
      message: 'User registered successfully',
      data: {
        user: {
          id: user.id.toString(),
          email: user.email,
          fullName: user.fullName,
          phone: user.phone,
          isActive: user.isActive,
          organization: {
            id: user.organization.id.toString(),
            name: user.organization.name,
            code: user.organization.code,
          },
          role: user.role.name,
        },
        token,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: 'Registration failed',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        error: 'Missing credentials',
        message: 'Email and password are required',
      });
    }

    // Find user with organization and role
    const user = await prisma.User.findUnique({
      where: { email },
      include: {
        organization: true,
        role: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect',
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        error: 'Account disabled',
        message:
          'Your account has been disabled. Please contact administrator.',
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwordHash);

    if (!validPassword) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect',
      });
    }

    // Generate token
    const token = generateToken(user);

    // Return user data without password
    res.json({
      message: 'Login successful',
      data: {
        user: {
          id: user.id.toString(),
          email: user.email,
          fullName: user.fullName,
          phone: user.phone,
          isActive: user.isActive,
          organization: {
            id: user.organization.id.toString(),
            name: user.organization.name,
            code: user.organization.code,
          },
          role: user.role.name,
        },
        token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Login failed',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// Verify token (for checking if user is still logged in)
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    if (!token) {
      return res.status(401).json({
        error: 'No token provided',
        message: 'Authentication required',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get fresh user data
    const user = await prisma.User.findUnique({
      where: { id: BigInt(decoded.id) },
      include: {
        organization: true,
        role: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        error: 'Invalid user',
        message: 'User not found or inactive',
      });
    }

    res.json({
      message: 'Token valid',
      data: {
        user: {
          id: user.id.toString(),
          email: user.email,
          fullName: user.fullName,
          phone: user.phone,
          isActive: user.isActive,
          organization: {
            id: user.organization.id.toString(),
            name: user.organization.name,
            code: user.organization.code,
          },
          role: user.role.name,
        },
      },
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Please login again',
      });
    }

    return res.status(401).json({
      error: 'Invalid token',
      message: 'Authentication failed',
    });
  }
});

module.exports = router;









