/**
 * Patches the generated Prisma client to use the adapter-only runtime
 * instead of the native library engine. This is needed for Neon Functions
 * where native binary engines aren't available.
 */
const fs = require('fs');
const path = require('path');

const clientDir = path.join(__dirname, '..', 'node_modules', '.prisma', 'client');
const indexPath = path.join(clientDir, 'index.js');

let content = fs.readFileSync(indexPath, 'utf8');

// Replace the library runtime with the client runtime (adapter-only, no binary engine)
const patched = content.replace(
  "require('@prisma/client/runtime/library.js')",
  "require('@prisma/client/runtime/client.js')"
);

if (patched === content) {
  console.log('[patch-prisma] No changes needed (already patched or different format)');
} else {
  fs.writeFileSync(indexPath, patched);
  console.log('[patch-prisma] Patched .prisma/client/index.js to use client runtime');
}
