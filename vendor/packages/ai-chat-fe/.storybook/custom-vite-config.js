import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// CopilotKit ships its own compiled CSS (`@copilotkit/react-core/v2/styles.css`); Tailwind is only
// here so the container's utility classes render in stories the way they do inside the client.
export default defineConfig({
  build: { target: 'esnext' },
  plugins: [tailwindcss(), react()],
  // Pre-bundle so Vite picks the ESM build once instead of discovering the CJS/ESM pair on first render.
  optimizeDeps: { include: ['@copilotkit/react-core/v2'] },
})
