#!/usr/bin/env node
'use strict';

/**
 * Tiny static server for previewing the built /demo locally.
 *   npm run build:demo && node scripts/serve-demo.js
 * Then open http://localhost:4000/  (form) and /admin.html (dashboard).
 * This is ONLY for local preview — the real demo is the static files in /demo.
 */

const path = require('path');
const express = require('express');

const app = express();
const PORT = Number(process.env.DEMO_PORT) || 4000;
app.use(express.static(path.join(__dirname, '..', 'demo'), { extensions: ['html'] }));
app.listen(PORT, () => {
  console.log(`Static demo preview: http://localhost:${PORT}/  (and /admin.html)`);
});
