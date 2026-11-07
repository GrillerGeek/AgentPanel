import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Separate graph: normal app builds never import Ghostty or emit its WASM.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist-ghostty-spike", rollupOptions: { input: "ghostty-spike.html" }, sourcemap: false },
  server: { host: "127.0.0.1", port: 1422, strictPort: true },
});
