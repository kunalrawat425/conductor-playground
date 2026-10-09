import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://www.relifish.com",
  adapter: vercel(),
  integrations: [
    sitemap({
      filter: (page) => {
        const blocked = ["/dashboard", "/me", "/track", "/search", "/v1", "/mfm-pitch", "/preorder"];
        return !blocked.some((b) => page.includes(b));
      },
      // Match canonicalFor() in src/lib/brand.ts: no trailing slash except the root.
      serialize: (item) => {
        const u = new URL(item.url);
        u.pathname = u.pathname.replace(/\/+$/, "") || "/";
        return { ...item, url: u.href };
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
