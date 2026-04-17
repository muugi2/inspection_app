#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

// Try different possible standalone paths
const possiblePaths = [
  path.join(process.cwd(), '.next/standalone/server.js'),
  path.join(process.cwd(), '.next/standalone/admin-web/server.js'),
];

const nextBuildPath = path.join(process.cwd(), '.next');

// Check if build exists
if (!fs.existsSync(nextBuildPath)) {
  console.error('❌ Error: Build not found!');
  console.log('📦 Please run "npm run build" first to create a production build.');
  process.exit(1);
}

// Find standalone server path
let standalonePath = null;
for (const possiblePath of possiblePaths) {
  if (fs.existsSync(possiblePath)) {
    standalonePath = possiblePath;
    break;
  }
}

const port = process.env.PORT || '3000';

// Check if network access is requested
const useNetwork = process.env.ALLOW_NETWORK === 'true' || process.argv.includes('--network');
const hostname = useNetwork ? '0.0.0.0' : 'localhost';

// Set environment variables for production
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: port,
  HOSTNAME: hostname,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://192.168.1.35:4555',
};

console.log('🚀 Starting production server...\n');
console.log(`🌐 Server will be available at:`);
if (useNetwork) {
  console.log(`   - Local:   http://localhost:${port}`);
  console.log(`   - Network: http://192.168.1.35:${port}`);
  console.log(`   ⚠️  Note: Use http://localhost:${port} or http://192.168.1.35:${port} in your browser`);
  console.log(`   ❌ Do NOT use http://0.0.0.0:${port} (browsers don't support 0.0.0.0)`);
} else {
  console.log(`   - Local:   http://localhost:${port}`);
  console.log(`   💡 For network access, use: npm start -- --network`);
}
console.log('');

// Check if standalone output exists
if (standalonePath) {
  console.log('✅ Using standalone server...');
  console.log(`📁 Server path: ${standalonePath}\n`);
  
  // Determine working directory (if server.js is in subfolder, use that folder)
  const serverDir = path.dirname(standalonePath);
  const serverFile = path.basename(standalonePath);
  
  // Check if static files exist in standalone folder
  const standaloneStaticPath = path.join(serverDir, '.next', 'static');
  const projectStaticPath = path.join(process.cwd(), '.next', 'static');
  
  // If static files don't exist in standalone folder, copy them
  if (!fs.existsSync(standaloneStaticPath) && fs.existsSync(projectStaticPath)) {
    console.log('📦 Copying static files to standalone folder...');
    try {
      // Run copy script
      const copyScript = path.join(process.cwd(), 'scripts', 'copy-static.js');
      if (fs.existsSync(copyScript)) {
        execSync(`node "${copyScript}"`, { stdio: 'inherit' });
      } else {
        // Manual copy if script doesn't exist
        const standaloneNextDir = path.join(serverDir, '.next');
        if (!fs.existsSync(standaloneNextDir)) {
          fs.mkdirSync(standaloneNextDir, { recursive: true });
        }
        // Simple copy (for small files)
        console.log('⚠️  Copy script not found, static files may not load correctly');
        console.log('💡 Run: node scripts/copy-static.js');
      }
    } catch (error) {
      console.log('⚠️  Could not copy static files:', error.message);
      console.log('💡 Static files may not load correctly');
    }
  }
  
  // Run standalone server from its directory
  const server = spawn('node', [serverFile], {
    cwd: serverDir,
    stdio: 'inherit',
    shell: true,
    env: env,
  });
  
  server.on('error', (error) => {
    console.error('❌ Error starting server:', error);
    process.exit(1);
  });
  
  server.on('exit', (code) => {
    if (code !== 0) {
      console.error(`\n❌ Server exited with code ${code}`);
      console.log('💡 Try running: npm run build');
    }
    process.exit(code || 0);
  });
  
  // Handle process termination
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down server...');
    server.kill('SIGINT');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    server.kill('SIGTERM');
    process.exit(0);
  });
  
} else {
  console.log('⚠️  Standalone build not found, using next start instead...');
  console.log('💡 Tip: Run "npm run build" to create a standalone build for better performance.\n');
  
  // Fallback to next start - but this won't work with standalone output
  // So we'll just show an error
  console.error('❌ Error: Standalone build not found and next start does not work with standalone output.');
  console.log('📦 Please run: npm run build');
  process.exit(1);
}
