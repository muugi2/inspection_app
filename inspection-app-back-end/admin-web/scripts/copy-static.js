#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Copy static files from project root to standalone folder
const projectStaticPath = path.join(process.cwd(), '.next', 'static');
const standaloneBasePath = path.join(process.cwd(), '.next', 'standalone');

// Try different possible standalone folder structures
const possibleStandalonePaths = [
  path.join(standaloneBasePath, 'admin-web'), // Structure: .next/standalone/admin-web/
  standaloneBasePath, // Structure: .next/standalone/
];

if (!fs.existsSync(projectStaticPath)) {
  console.error('❌ Static files not found at:', projectStaticPath);
  process.exit(1);
}

if (!fs.existsSync(standaloneBasePath)) {
  console.error('❌ Standalone base folder not found at:', standaloneBasePath);
  console.log('💡 This script should run after "npm run build"');
  process.exit(1);
}

// Find which standalone structure exists
let standalonePath = null;
for (const possiblePath of possibleStandalonePaths) {
  if (fs.existsSync(possiblePath)) {
    standalonePath = possiblePath;
    break;
  }
}

if (!standalonePath) {
  console.error('❌ Standalone folder not found in any expected location');
  console.log('   Tried:', possibleStandalonePaths);
  process.exit(1);
}

const standaloneStaticPath = path.join(standalonePath, '.next', 'static');

// Create .next directory in standalone folder if it doesn't exist
const standaloneNextDir = path.join(standalonePath, '.next');
if (!fs.existsSync(standaloneNextDir)) {
  fs.mkdirSync(standaloneNextDir, { recursive: true });
}

// Copy static files
function copyRecursive(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(childItemName => {
      copyRecursive(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

try {
  console.log(`📁 Found standalone folder at: ${standalonePath}`);
  
  if (fs.existsSync(standaloneStaticPath)) {
    console.log('🗑️  Removing existing static files...');
    fs.rmSync(standaloneStaticPath, { recursive: true, force: true });
  }
  
  console.log('📦 Copying static files...');
  console.log(`   From: ${projectStaticPath}`);
  console.log(`   To:   ${standaloneStaticPath}`);
  copyRecursive(projectStaticPath, standaloneStaticPath);
  console.log('✅ Static files copied successfully!');
} catch (error) {
  console.error('❌ Error copying static files:', error.message);
  console.log('⚠️  Build will continue, but static files may not be available');
  // Don't exit with error - let build continue
  // process.exit(1);
}

