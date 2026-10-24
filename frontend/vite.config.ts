import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the UI with hot reload on :5173 and forwards /api to the Rust server on :8000.
// `npm run build` writes frontend/dist, which the Rust server serves directly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 5000, // Monaco is one large chunk (~1 MB gzipped); that's expected
  },
});
