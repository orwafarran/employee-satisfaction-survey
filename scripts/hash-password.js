#!/usr/bin/env node
'use strict';

/**
 * Generate a scrypt password hash for ADMIN_PASSWORD_HASH.
 * Usage:  node scripts/hash-password.js "my strong password"
 */

const { hashPassword } = require('../server/auth/hash');

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: node scripts/hash-password.js "your strong password"');
  process.exit(1);
}

console.log(hashPassword(pw));
