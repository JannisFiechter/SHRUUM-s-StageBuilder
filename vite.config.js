import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" erlaubt das Hosting in einem Unterordner, z. B. GitHub Pages.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { target: "es2020", sourcemap: false },
});
