/**
 * electron-builder requires afterPack hooks to resolve inside the app project
 * directory. This shim lives under apps/desktop and forwards to the real
 * implementation in the repository root (which copies the flattened harness
 * payload into resources/runtime).
 */
module.exports = require('../../scripts/electron-after-pack.cjs')
