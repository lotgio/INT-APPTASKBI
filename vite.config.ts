import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/INT-APPTASKBI/",
  plugins: [react()],
  server: {
    port: 5173
    // Proxy disabled to avoid Node.js crashes
  },
  preview: {
    port: 5173
  }
});
