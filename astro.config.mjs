import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

export default defineConfig({
  adapter: vercel(),
  vite: {
    server: {
      host: true,
      allowedHosts: true,
    },
  },
});
