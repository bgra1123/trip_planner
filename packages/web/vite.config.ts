import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allows the temporary cloudflared tunnel's random hostname through Vite's
    // Host-header check. Fine for a local dev server behind a throwaway tunnel;
    // the actual trip data is still gated by the API's bearer token, not this.
    allowedHosts: true,
  },
});
