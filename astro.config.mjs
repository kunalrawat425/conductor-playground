import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

export default defineConfig({
  site: "https://www.relifish.com",
  adapter: vercel(),
  // CSS goes inside each page (no /_astro/*.css file). After a deploy the old CSS files are gone (404),
  // so a tab still holding the old page used to show unstyled (founder, 31 Oct). Inline CSS can't go missing.
  build: { inlineStylesheets: "always" },
  redirects: {
    // Old static seller pitch pages (they quoted commission and fees) are offline; their links land on /for-sellers.
    "/seller-banner": "/for-sellers",
    "/seller-banner.html": "/for-sellers",
    "/seller-simple.html": "/for-sellers",
    "/seller-detailed.html": "/for-sellers",
    "/seller-onboard.html": "/for-sellers",
    "/seller-pitch-flyer.html": "/for-sellers",
    "/sop.html": "/for-sellers",
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
