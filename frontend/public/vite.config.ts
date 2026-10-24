import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The CodeTutor frontend is rooted here (frontend/public) to match the
// existing src/ layout. Static assets, if any, can live in ./static.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
