import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages serves a project site under /<repo>/, so assets must be
// requested from that sub-path. Change this if the repo is renamed, or set
// it to '/' for a user/org root site (username.github.io).
const base = '/SSHtorm/';

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [vue(), tailwindcss()],
  server: { host: true }
});
