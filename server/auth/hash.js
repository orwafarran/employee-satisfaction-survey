'use strict';

/**
 * Password hashing using Node's built-in crypto.scrypt (no native deps).
 * Stored format:  scrypt$<N>$<saltBase64>$<hashBase64>
 */

const crypto = require('crypto');

const SCRYPT_N = 16384; // CPU/memory cost
const KEYLEN = 64;
const SALT_BYTES = 16;

function hashPassword(plain) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(String(plain), salt, KEYLEN, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  let actual;
  try {
    actual = crypto.scryptSync(String(plain), salt, expected.length, { N });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
