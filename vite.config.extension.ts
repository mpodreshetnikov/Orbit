import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = path.resolve(__dirname);
const extensionDir = path.join(rootDir, "browserExtension");
const distDir = path.join(extensionDir, "dist");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.join(rootDir, "src"),
    },
  },
  root: rootDir,
  build: {
    outDir: distDir,
    emptyOutDir: false,
    rollupOptions: {
      input: {
        popup: path.join(extensionDir, "popup-src", "main.tsx"),
      },
      output: {
        entryFileNames: "popup.js",
        chunkFileNames: "popup-[name].js",
        assetFileNames: (assetInfo) => {
          return assetInfo.name?.endsWith(".css") ? "popup.css" : "popup-[name][extname]";
        },
      },
    },
    sourcemap: true,
  },
});
