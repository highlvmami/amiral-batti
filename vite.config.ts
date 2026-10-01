import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: {
    // Listen on all interfaces so other devices on the LAN can open the dev server.
    host: true,
    proxy: {
      "/ws": { target: "ws://localhost:3000", ws: true },
      "/api": "http://localhost:3000",
    },
  },
});
