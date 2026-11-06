import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Own project root (this dir). Framework and views are shared by relative
// import, so the dev server is allowed to read the repo root.
const root = new URL(".", import.meta.url).pathname;
const repo = new URL("../..", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  root,
  server: {
    fs: {
      allow: [repo],
    },
  },
});
