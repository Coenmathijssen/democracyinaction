import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const src = (path) => fileURLToPath(new URL(`./src/${path}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': src(''),
      // GSAP comes from Webflow's GSAP integration, not from the bundle.
      gsap: src('vendor/gsap.js'),
    },
  },
  server: {
    port: 5173,
    cors: true,
  },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/main.js',
      output: {
        format: 'iife',
        entryFileNames: 'main.js',
        assetFileNames: 'main.[ext]',
      },
    },
  },
})
