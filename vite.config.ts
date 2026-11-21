/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { reviewPlugin } from './pipeline/review/devServer.ts'
import { posterManifest, recordCues, shippedRecord } from './src/data/shipped.ts'

// Everything the service worker precaches. Raise deliberately when baked media lands.
const PRECACHE_BUDGET = 8 * 1024 * 1024
const MOTION_TESTS = ['src/motion/**/*.test.ts', 'src/features/figure/motion/**/*.test.ts', 'pipeline/motion/**/*.test.ts']

function precacheBudget<T extends { url: string; size: number }>(entries: T[]) {
  const total = entries.reduce((s, e) => s + e.size, 0)
  const kib = (n: number) => `${(n / 1024).toFixed(1)} KiB`
  const largest = [...entries].sort((a, b) => b.size - a.size).slice(0, 5)
  console.log(`\nprecache: ${entries.length} files, ${kib(total)} of ${kib(PRECACHE_BUDGET)} budget`)
  for (const e of largest) console.log(`  ${kib(e.size).padStart(11)}  ${e.url}`)
  if (total > PRECACHE_BUDGET) throw new Error(`Precache is ${kib(total)}, over the ${kib(PRECACHE_BUDGET)} budget`)
  return { manifest: entries }
}

// What the app bundles from data/: catalog.ts imports records with ?shipped, cues.en.ts with ?cues, posters.ts the
// manifest. Review notes stay out (/dev/review reads the record files directly).
function shippedData(): Plugin {
  const record = /[\\/]data[\\/]exercises[\\/][^\\/]+\.json$/
  const manifest = /[\\/]public[\\/]media[\\/]manifest\.json$/
  return {
    name: 'shipped-data',
    enforce: 'pre',
    transform(code, id) {
      const [file, query] = id.split('?')
      if (manifest.test(file)) return { code: posterManifest(code), map: null }
      if (!record.test(file) || (query !== 'shipped' && query !== 'cues')) return null
      // Queried JSON is not picked up by the JSON plugin in dev and tests, so it becomes a module here.
      return { code: `export default ${query === 'shipped' ? shippedRecord(code) : recordCues(code)}`, map: null }
    },
  }
}

// Production builds route without the src/routes/dev.* tools. That tree goes outside src/ so the dev tree, which
// typecheck reads, keeps the /dev/* routes.
const PROD_ROUTE_TREE = fileURLToPath(new URL('./node_modules/.tmp/routeTree.prod.gen.ts', import.meta.url))

export default defineConfig(({ mode }) => ({
  resolve: mode === 'production' ? { alias: [{ find: /^\.\/routeTree\.gen$/, replacement: PROD_ROUTE_TREE }] } : undefined,
  plugins: [
    shippedData(),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      ...(mode === 'production' ? { routeFileIgnorePattern: '^dev\\.', generatedRouteTree: PROD_ROUTE_TREE } : {}),
    }),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      injectRegister: 'script',
      registerType: 'prompt',
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'Tenset',
        short_name: 'Tenset',
        description: 'An exercise library with demo loops and the muscles each exercise works, filtered by the equipment you have.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // --color-canvas (light); index.html sets the dark theme-color per scheme
        theme_color: '#f2f3f5',
        background_color: '#f2f3f5',
        categories: ['health', 'fitness', 'sports'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,bin,txt,woff2}'],
        // The notices file (~250 KB) is only opened from /credits, so it stays network-only. The figure model and
        // atlas only feed the dev review page and the loop bake. Loops and posters are cached on first use
        // (src/sw/sw.ts) so the precache does not grow with the catalog.
        globIgnores: ['**/media/loops/**', '**/media/posters/**', '**/models/**', '**/THIRD_PARTY_NOTICES.txt'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        manifestTransforms: [precacheBudget],
      },
    }),
    // dev server only: /__review endpoints behind /dev/review
    reviewPlugin(),
  ],
  optimizeDeps: { entries: ['index.html'] },
  test: {
    environment: 'node',
    // motion re-bakes and judges every shipped loop (minutes of CPU); pnpm test leaves it to pnpm test:motion and CI
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'pipeline/**/*.test.ts', 'data/**/*.test.ts'],
          exclude: [...MOTION_TESTS, '**/node_modules/**'],
          setupFiles: ['src/data/test-setup.ts'],
        },
      },
      { extends: true, test: { name: 'motion', include: MOTION_TESTS } },
    ],
  },
}))
