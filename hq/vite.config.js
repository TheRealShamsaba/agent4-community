import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// The build must stay a single self-contained file: AGENT4 injects state into it
// and delivers it over Telegram, where it opens offline with no server.
export default defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:8782' } },
  plugins: [react(), viteSingleFile()]
});
