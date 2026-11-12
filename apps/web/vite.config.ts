import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tanstackStart(), viteReact(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    // Dev-only tunnels/proxies forward an external Host header; Vite rejects
    // unknown hosts unless they are allowed. Keep the production build strict.
    allowedHosts: [".all-hands.dev", "localhost", "127.0.0.1"],
  },
});
