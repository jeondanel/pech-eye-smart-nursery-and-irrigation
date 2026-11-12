import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, forward API + image requests to the Node server.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/images": "http://localhost:3001",
    },
  },
});
