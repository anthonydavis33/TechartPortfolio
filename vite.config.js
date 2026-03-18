import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { kbManifestPlugin } from "./scripts/vite-kb-manifest.mjs";

export default defineConfig({
  plugins: [react(), kbManifestPlugin()],
  base: "/TechartPortfolio/"
});
