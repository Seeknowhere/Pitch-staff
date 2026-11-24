import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // relative paths, so the site works at seeknowhere.github.io/Pitch-staff/
  base: './',
  plugins: [react()],
})
