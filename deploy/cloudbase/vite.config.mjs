import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  configFile: false,
  publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("../..", import.meta.url)) } },
  build: { outDir: "../../outputs/cloudbase/web", emptyOutDir: true },
});
