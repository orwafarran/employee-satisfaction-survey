/**
 * Runtime configuration.
 *
 * mode = "api"  -> talks to the Express backend (the full local/hosted app).
 * mode = "demo" -> no backend; uses bundled sample data + localStorage. The
 *                  static GitHub Pages build (Phase 5) ships a config.js with
 *                  mode = "demo".
 *
 * This file is the API-mode version. scripts/build-demo.js overwrites it in the
 * /demo build.
 */
window.APP_CONFIG = {
  mode: 'api',
  // Shown on the demo dashboard banner; ignored in api mode.
  demoNote: '',
};
