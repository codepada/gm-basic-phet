import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isGitHubActions = Boolean(globalThis.process?.env?.GITHUB_ACTIONS);

export default defineConfig({
  base: isGitHubActions ? "/gm-basic-phet/" : "/",
  plugins: [react()],
});
