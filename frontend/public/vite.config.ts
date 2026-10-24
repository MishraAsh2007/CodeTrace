import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The CodeTutor frontend is rooted here (frontend/public) to match the
// existing src/ layout. Static assets, if any, can live in ./static.
export default defineConfig({
  plugins: [react()],
  server: {
    // The C app runs on 5175 so it doesn't collide with the Java app (5173)
    // or the Python app (8000) when all three run together for the demo.
    port: 5175,
  },
});
