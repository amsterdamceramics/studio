import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative paths, so the built site runs from any address, including a sub-folder such as GitHub Pages.
  base: './',
  plugins: [react()],
})
