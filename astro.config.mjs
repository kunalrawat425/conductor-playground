import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

export default defineConfig({
  adapter: vercel(),
  vite: {
    server: {
      host: true,
      allowedHosts: true,
    },
    // CommonJS web-push breaks when fully bundled (setVapidDetails not a function); load from node_modules at runtime
    ssr: {
      external: ["web-push"],
    },
  },
});
