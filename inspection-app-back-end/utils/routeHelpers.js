/**
 * Common utility functions for Express routes
 */

/**
 * Serialize BigInt values to strings for JSON responses
 * @param {*} obj - Object to serialize
 * @returns {*} Serialized object
 */
const serializeBigInt = obj => {
  return JSON.parse(
    JSON.stringify(obj, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
};

/**
 * Handle common error responses with appropriate status codes
 * @param {Response} res - Express response object
 * @param {Error} error - Error object
 * @param {string} operation - Operation description for logging
 * @returns {Response} Express response
 */
function handleError(res, error, operation = 'operation') {
  console.error(`Error ${operation}:`, error);

  if (
    error.message.includes('not found') ||
    error.message.includes('does not exist')
  ) {
    return res.status(404).json({ error: 'Not Found', message: error.message });
  }

  if (error.message.includes('access')) {
    return res.status(403).json({ error: 'Forbidden', message: error.message });
  }

  if (error.message.includes('Validation') || error.message.includes('required')) {
    return res.status(400).json({ error: 'Validation Error', message: error.message });
  }

  return res.status(500).json({
    error: `Failed to ${operation}`,
    message:
      process.env.NODE_ENV === 'development'
        ? error.message
        : 'Internal server error',
  });
}

/**
 * Parse BigInt ID from request parameter
 * @param {string|number} id - ID from request
 * @returns {BigInt} Parsed BigInt ID
 */
function parseBigIntId(id) {
  try {
    return BigInt(id);
  } catch (error) {
    throw new Error(`Invalid ID format: ${id}`);
  }
}

/**
 * Format datetime for consistent API responses
 * @param {Date|string} value - Date value to format
 * @returns {string|null} Formatted datetime or null
 */
const formatDateTime = value => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.toISOString();
};

module.exports = {
  serializeBigInt,
  handleError,
  parseBigIntId,
  formatDateTime,
};







