import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Enable standalone output for Docker
  output: 'standalone',
  
  // Environment variables that will be available in the browser
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://192.168.1.71:4555',
  },
};

export default nextConfig;
