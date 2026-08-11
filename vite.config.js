import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const basePath = globalThis.process?.env?.VITE_BASE_PATH || "/";

export default defineConfig({
  base: basePath,
  plugins: [react()],
});
