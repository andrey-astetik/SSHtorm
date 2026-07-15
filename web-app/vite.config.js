import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Treat Electron's <webview> as a native custom element (used by WebBrowser.vue)
    vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'webview' } } }),
    tailwindcss()
  ],
  // Use relative base for Electron file:// protocol in production
  base: './',
  server: {
    host: true,
    port: 5173
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})