import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: {
    proxy: { "/ws": { target: "ws://localhost:3000", ws: true } },
  },
});
