/**
 * Browser client bundle for @dsh/plugin-desktop-bridge, mirroring the
 * DeepSeek Harness client preset logic (see packages/client/tsdown.client.ts)
 * for an external plugin package: a closure-factory artifact that calls
 * window.__ModuleLoader__.load({ id, factory }) and resolves externals
 * through the injected require (loader module table).
 *
 * The three pieces that make a factory-form bundle load cleanly in the host
 * shell:
 *   1. `outputOptions.intro` declares the factory-local `module`/`exports`
 *      (the factory only receives `require` — without this the emitted CJS
 *      hits `exports is not defined` and the whole section is skipped).
 *   2. `define` substitutes `process.env.NODE_ENV` at build time (react
 *      dev/prod branches), so no `process` global is needed at runtime.
 *   3. `deps.neverBundle` + `deps.alwaysBundle` keep react/react/jsx-runtime
 *      out of the bundle (the loader module table supplies them); everything
 *      else inlines.
 */
import { defineConfig } from 'tsdown'

// MUST equal the loader entry name (= npm package name, = cordis.patch.yml `name`).
const id = '@dsh/plugin-desktop-bridge'

/** Externals resolved from the loader module table at runtime. */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime']

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  // package.json exports["./client"] points at client/client.js.
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  // Externals resolved from the loader module table at runtime.
  deps: {
    // Anything in the loader module table stays external.
    neverBundle: (source: string) => CLIENT_EXTERNALS.includes(source),
    // Anything NOT in the loader module table must inline instead — a require()
    // the table cannot answer is a guaranteed runtime throw.
    alwaysBundle: (source: string) => !CLIENT_EXTERNALS.includes(source),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  outputOptions: {
    // Emit client.js (not client.cjs) to match package.json exports["./client"].
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
