import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://relifish.store",
  adapter: vercel(),
  integrations: [
    sitemap({
      filter: (page) => {
        const blocked = ["/dashboard", "/me", "/track", "/search", "/v1", "/mfm-pitch", "/preorder"];
        return !blocked.some((b) => page.includes(b));
      },
    }),
  ],
  redirects: {
    "/seller-banner": "/seller-banner.html",
  },
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
