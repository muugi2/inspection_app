const fs = require('fs/promises');
const path = require('path');

const DEFAULT_STORAGE_PATH =
  process.env.FTP_STORAGE_PATH || path.resolve('C:/ftp_data');
const DEFAULT_PUBLIC_BASE_URL =
  process.env.FTP_PUBLIC_BASE_URL ||
  'http://192.168.1.54:4555/uploads';
const FTP_REMOTE_PREFIX = (process.env.FTP_REMOTE_PREFIX || 'test')
  .trim()
  .replace(/^\/+|\/+$/g, '');

function normalizeRelativePath(input) {
  if (!input) {
    return null;
  }

  let value = String(input).trim();
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    value = parsed.pathname || '';
  } catch (error) {
    // Ignore parse errors – input is not a URL
  }

  value = value.replace(/\\/g, '/');
  value = value.replace(/^\/+/, '');

  const segments = value
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment && segment !== '.' && segment !== '..');

  if (segments.length === 0) {
    return null;
  }

  return segments.join('/');
}

function stripRemotePrefix(relativePath) {
  if (!relativePath) {
    return null;
  }

  if (!FTP_REMOTE_PREFIX) {
    return relativePath;
  }

  const prefixWithSlash = `${FTP_REMOTE_PREFIX}/`;
  if (relativePath === FTP_REMOTE_PREFIX) {
    return '';
  }

  if (relativePath.startsWith(prefixWithSlash)) {
    return relativePath.slice(prefixWithSlash.length);
  }

  return relativePath;
}

function resolveLocalPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) {
    return null;
  }

  let sanitized = stripRemotePrefix(normalized);
  if (!sanitized) {
    return null;
  }

  // FTP_STORAGE_PATH ихэвчлэн uploads хавтас руу заадаг (/app/uploads). DB-д "uploads/xxx" гэж хадгалагдсан бол
  // base + "uploads/xxx" = .../uploads/uploads/xxx болж давхардана. Тиймээс "uploads/" префиксийг нэг удаа хасана.
  if (sanitized.toLowerCase().startsWith('uploads/')) {
    sanitized = sanitized.slice(8); // "uploads/".length
  }

  const base = path.resolve(DEFAULT_STORAGE_PATH);
  const absolutePath = path.resolve(base, sanitized);

  if (!absolutePath.startsWith(base)) {
    throw new Error(`Invalid path traversal attempt: ${relativePath}`);
  }

  return absolutePath;
}

async function readImageAsBase64(relativePath) {
  const localPath = resolveLocalPath(relativePath);
  if (!localPath) {
    return null;
  }

  try {
    const fileBuffer = await fs.readFile(localPath);
    return fileBuffer.toString('base64');
  } catch (error) {
    console.error(
      `[imageStorage] Failed to read file ${localPath}: ${error.message}`
    );
    return null;
  }
}

function buildPublicUrl(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) {
    return null;
  }

  const sanitized = stripRemotePrefix(normalized);
  if (!sanitized) {
    return null;
  }

  const base = DEFAULT_PUBLIC_BASE_URL.replace(/\/+$/, '');
  return `${base}/${sanitized}`;
}

/**
 * Локал файл олдохгүй бол FTP_PUBLIC_BASE_URL (HTTP) -аас татах fallback.
 * Зургийн URL нь ихэвчлен .../uploads/filename.jpg тул path-ийн сүүлийн сегментийг ашиглана.
 */
async function fetchImageFromPublicUrl(relativePath) {
  const base = (DEFAULT_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  const pathPart = relativePath.replace(/^uploads\/?/, '').trim() || relativePath;
  const url = `${base}/${pathPart}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    if (!fileBuffer || fileBuffer.length === 0) return null;
    const base64String = fileBuffer.toString('base64');
    console.log(`[imageStorage] ✅ Fetched from URL: ${url} (${fileBuffer.length} bytes)`);
    return { base64: base64String, buffer: fileBuffer, size: fileBuffer.length, localPath: null };
  } catch (err) {
    console.warn(`[imageStorage] ⚠️ HTTP fetch failed for ${url}:`, err.message);
    return null;
  }
}

async function loadImagePayload(relativePath) {
  console.log(`[imageStorage] loadImagePayload called with: ${relativePath}`);
  
  const localPath = resolveLocalPath(relativePath);
  if (!localPath) {
    console.warn(
      `[imageStorage] ❌ Failed to resolve local path for: ${relativePath}`
    );
    return { base64: null, buffer: null, size: null, localPath: null };
  }

  console.log(`[imageStorage] Resolved local path: ${localPath}`);

  try {
    // Check if file exists
    try {
      await fs.access(localPath);
      console.log(`[imageStorage] ✅ File exists: ${localPath}`);
    } catch (accessError) {
      console.error(
        `[imageStorage] ❌ File does not exist: ${localPath}`,
        accessError.message
      );
      const fromUrl = await fetchImageFromPublicUrl(relativePath);
      if (fromUrl) return fromUrl;
      return {
        base64: null,
        buffer: null,
        size: null,
        localPath,
        error: 'File not found',
      };
    }

    const fileBuffer = await fs.readFile(localPath);
    console.log(
      `[imageStorage] ✅ File read successfully: ${localPath} (${fileBuffer.length} bytes)`
    );
    
    const stats = await fs.stat(localPath);
    console.log(
      `[imageStorage] File stats: size=${stats.size} bytes, modified=${stats.mtime}`
    );
    
    // Validate buffer
    if (!fileBuffer || fileBuffer.length === 0) {
      console.error(`[imageStorage] ❌ File buffer is empty: ${localPath}`);
      return {
        base64: null,
        buffer: null,
        size: null,
        localPath,
        error: 'Empty file',
      };
    }

    // Convert to base64 (for APIs that still need it). This is lossless and
    // Node.js will not insert line breaks or truncate the string.
    const base64String = fileBuffer.toString('base64');
    if (!base64String || base64String.length === 0) {
      console.error(
        `[imageStorage] ❌ Base64 conversion failed: ${localPath}`
      );
      return {
        base64: null,
        buffer: fileBuffer,
        size: stats.size,
        localPath,
        error: 'Base64 conversion failed',
      };
    }

    console.log(
      `[imageStorage] ✅ Base64 conversion successful: ${localPath} (${base64String.length} chars)`
    );

    return {
      base64: base64String,
      buffer: fileBuffer,
      size: stats.size,
      localPath,
    };
  } catch (error) {
    console.error(
      `[imageStorage] ❌ Failed to load payload for ${localPath}:`,
      error.message,
      error.stack
    );
    return {
      base64: null,
      buffer: null,
      size: null,
      localPath,
      error: error.message,
    };
  }
}

function inferMimeType(relativePath) {
  const normalized = normalizeRelativePath(relativePath) || '';
  const lower = normalized.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

module.exports = {
  normalizeRelativePath,
  resolveLocalPath,
  readImageAsBase64,
  buildPublicUrl,
  loadImagePayload,
  inferMimeType,
  DEFAULT_STORAGE_PATH,
  DEFAULT_PUBLIC_BASE_URL,
  FTP_REMOTE_PREFIX,
};

